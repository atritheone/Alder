"""Bounded, cancellable proofreading jobs; manuscript text stays in memory."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import copy
import json
from pathlib import Path
import threading
import time
import uuid
from bisect import bisect_right

from .. import language
from ..models import ValidationError
from .contracts import (DIALECTS, blocks, configuration, diagnostic,
                        fingerprint, model_correction, shift, slice16, u16, language_segments)
from .engines import ModelEngine, Resources, RuleEngine
from .revisions import passages as revision_passages, revision, complete_spelling, unchanged_internal_names
from .invariants import source_identifiers,restore_money_notation,narrowed_plural_terms

TERMINAL = {"completed", "partial", "failed", "cancelled"}


class ProofreadingService:
    def __init__(self, resources, data_dir, speech_busy=None):
        self.resources = Resources(resources)
        self.rules = RuleEngine(self.resources)
        self.model = ModelEngine(self.resources)
        self.data_dir = Path(data_dir)
        self.speech_busy = speech_busy or (lambda: False)
        self.lock = threading.RLock()
        self.jobs = {}
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="alder-proofreading")
        self.advanced_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="alder-grammar")
        self.closed = threading.Event()
        self.maintenance = threading.Thread(target=self._maintain, daemon=True, name="proofreading-idle")
        self.maintenance.start()

    def capabilities(self):
        return {"offline": True, "dialects": list(DIALECTS), "offsetEncoding": "utf-16",
                "engines": self.resources.capabilities(), "advancedQuality": "experimental",
                "maximumTextLength": None, "maximumFindings": None}

    def personal_words(self):
        try:
            words = json.loads((self.data_dir / "proofreading-dictionary.json").read_text("utf-8"))
            return configuration({}, {"acceptedWords": words})["acceptedWords"]
        except (OSError, ValueError, ValidationError):
            return []

    def save_personal_words(self, words):
        words = configuration({}, {"acceptedWords": words})["acceptedWords"]
        with self.lock:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            path = self.data_dir / "proofreading-dictionary.json"
            temporary = path.with_suffix(".tmp")
            temporary.write_text(json.dumps(words, ensure_ascii=False), "utf-8")
            temporary.replace(path)
        return words

    def start(self, data, project=None):
        text = data.get("text")
        if not isinstance(text, str):
            raise ValidationError("Proofreading text must be a string.")
        try:
            text.encode("utf-16-le")
        except UnicodeError as exc:
            raise ValidationError("Text contains an incomplete Unicode character.") from exc
        target = data.get("targetId")
        if not isinstance(target, str) or not target or len(target) > 250:
            raise ValidationError("A proofreading target is required.")
        advanced = data.get("advanced", False)
        if type(advanced) is not bool:
            raise ValidationError("Advanced checking must be a boolean.")
        revise = data.get("revision", False)
        if type(revise) is not bool:
            raise ValidationError("Sentence revision must be a boolean.")
        revision_mode = data.get('revisionMode', 'improve')
        attempt = data.get('revisionAttempt', 0)
        if revision_mode not in ('improve', 'rephrase') or type(attempt) is not int or not 0 <= attempt <= 10000:
            raise ValidationError('Invalid sentence revision mode or attempt.')
        advanced = advanced or revise
        focus = data.get('focus', 0)
        if type(focus) is not int or not 0 <= focus <= u16(text):
            raise ValidationError('Invalid sentence revision focus.')
        selected = data.get("range")
        offset = 0
        checked_text = text
        if selected is not None:
            try:
                if not isinstance(selected, dict):
                    raise ValueError()
                offset = selected["start"]
                checked_text = slice16(text, offset, selected["end"])
                if not checked_text.strip():
                    raise ValueError()
            except (KeyError, ValueError, UnicodeError) as exc:
                raise ValidationError("Select a valid passage to check.") from exc
        project = copy.deepcopy(project or {})
        config = configuration(project, data.get("configuration"))
        default_language=project.get('language','en')
        if default_language.lower().split('-')[0]=='en':default_language=config['dialect']
        segments=language_segments(text,data.get('languageRanges'),default_language,selected)
        for segment in segments:
            if segment['language'].lower()=='en':segment['language']=config['dialect']
        config["acceptedWords"] = sorted(set(config["acceptedWords"] + self.personal_words()))
        if revise:
            config["task"] = "revise"
            config['revisionMode'] = revision_mode
            config['revisionAttempt'] = attempt
        key = fingerprint([config, project.get("settings", {}).get("customRules", []),
                           project.get("settings", {}).get("ignoredRules", []), project.get("dictionary", []),
                           [(s['start'],s['end'],s['language']) for s in segments]])
        with self.lock:
            if self.closed.is_set():
                raise ValidationError("Proofreading is shutting down.")
            for job in self.jobs.values():
                if job["targetId"] == target and job["status"] not in TERMINAL:
                    job["_cancel"].set()
            active = sum(job["status"] not in TERMINAL and not job["_cancel"].is_set() for job in self.jobs.values())
            if active >= 4:
                raise ValidationError("Four checks are already running. Cancel a check before starting another.")
            self._prune()
            if len(self.jobs) >= 24:
                raise ValidationError("Previous checks are still stopping. Try again shortly.")
            job = {"id": uuid.uuid4().hex, "schemaVersion": 1, "targetId": target,
                   "range": {"start": offset, "end": offset + u16(checked_text)},
                   "sourceHash": fingerprint(text), "configurationHash": key, "offsetEncoding": "utf-16",
                   "status": "queued", "stage": "rules", "annotations": [], "words": len(checked_text.split()),
                   "sentences": 0, "readingSeconds": round(len(checked_text.split()) / 3), "sequence": 0,
                   "coverage": {"totalBlocks": 0, "checkedBlocks": 0, "advancedBlocks": 0, "skippedBlocks": 0},
                   "message": "Waiting to check this text.", "truncated": False, "warnings": [],
                   "_cancel": threading.Event(), "_created": time.monotonic()}
            self.jobs[job["id"]] = job
            if revise:
                passages = list(revision_passages(text, checked_text, offset, segments, config, selected))
                passages.sort(key=lambda passage: 0 if passage['start'] <= focus <= passage['start'] + u16(passage['text']) else abs(passage['start'] - focus))
                coverage = {"totalBlocks": len(passages), "checkedBlocks": 0, "advancedBlocks": 0, "skippedBlocks": 0}
                self._update(job, status='running', stage='model', coverage=coverage)
                if not self.resources.capabilities()['model']['available']:
                    self._update(job, status='partial', warnings=['The local sentence revision model is unavailable.'],
                                 message='Sentence revision unavailable.')
                else:
                    self.advanced_pool.submit(self._advanced, job, passages, config, coverage, [])
                return self._public(job)
            self.pool.submit(self._run, job, checked_text, project, config, advanced,segments)
            return self._public(job)

    def _public(self, job):
        result = copy.deepcopy({key: value for key, value in job.items() if not key.startswith("_")})
        result["annotations"].sort(key=lambda a: (a["start"], a["end"], a["rule"]))
        return result

    def _update(self, job, **fields):
        with self.lock:
            job.update(fields)
            job["sequence"] += 1

    def _cancelled(self, job):
        return self.closed.is_set() or job["_cancel"].is_set()

    def _append(self, job, results):
        with self.lock:
            existing = job.setdefault("_seen", set())
            for item in results:
                key = (item["start"], item["end"], item.get("suggestion"))
                if key in existing:
                    continue
                job["annotations"].append(item)
                existing.add(key)
            job["sequence"] += 1

    def _run(self, job, text, project, config, advanced,segments):
        warnings = []
        try:
            if self._cancelled(job):
                return
            paragraphs=[]
            for segment in segments:
                for block in blocks(segment['text']):
                    block.update(start=block['start']+segment['start'],language=segment['language'])
                    paragraphs.append(block)
            coverage = {"totalBlocks": len(paragraphs), "checkedBlocks": 0,
                        "advancedBlocks": 0, "skippedBlocks": 0}
            self._update(job, status="running", message="Checking spelling and grammar…", coverage=coverage.copy())
            # Keep Alder's explicit project rules; optional style remains distinct.
            enabled = ["custom", "preferred-terms", "brackets"]
            rules_available = self.resources.capabilities()["rules"]["available"]
            if not rules_available:
                # Retain the original checker when opening an older installation.
                # Coverage remains partial: these checks are not full grammar.
                project["dictionary"] = project.get("dictionary", []) + [
                    {"word": word} for word in config["acceptedWords"]]
                warnings.append("Basic spelling and punctuation only: the local grammar resource pack is unavailable. Full grammar and dialect checks were not performed.")
            base = language.analyze(text, project, enabled)
            self._update(job, sentences=base["sentences"], truncated=base.get("truncated", False))
            project_findings = []
            encoded = text.encode("utf-16-le")
            excluded=[(s['start'],s['end']) for s in segments if s['language'].lower()=='zxx']
            excluded_ends=[end for _,end in excluded]
            findings=[(item,job['range']['start']) for item in base['annotations']]
            for segment in segments:
                if segment['language'].lower().split('-')[0]!='en':continue
                local_enabled=['concision','repetition','sentence-length','sentence-openings'] if config['style'] else []
                if not rules_available:local_enabled+=['spelling','punctuation']
                if local_enabled:
                    local=language.analyze(segment['text'],{**project,'language':segment['language']},local_enabled)
                    findings.extend((item,segment['start']) for item in local['annotations'])
            for item,origin in findings:
                rule = item.get("ruleId") or "alder:" + item["rule"]
                if rule in config["ignoredRuleIds"]:
                    continue
                start=item['start']+origin;end=item['end']+origin
                skip=bisect_right(excluded_ends,start)
                if skip<len(excluded) and excluded[skip][0]<end:continue
                original = encoded[(start-job['range']['start']) * 2:(end-job['range']['start']) * 2].decode("utf-16-le")
                project_findings.append(shift(diagnostic(original, 0, u16(original),
                                              "terminology" if item["rule"] in ("custom", "preferred-terms") else "spelling" if item["rule"] == "spelling" else "punctuation" if item["rule"] in ("brackets", "punctuation") else "style",
                                              rule, item["message"],
                                              [item["suggestion"]] if "suggestion" in item else [], "alder"), start))
            self._append(job, project_findings)
            resolved={tag:tag for tag in DIALECTS}
            unsupported=set()
            for block in paragraphs:
                if self._cancelled(job):
                    return
                tag=block['language']
                if tag.lower()=='zxx':
                    coverage['skippedBlocks']+=1
                    continue
                if not rules_available:
                    coverage["skippedBlocks"] += 1
                    continue
                if tag not in resolved:resolved[tag]=self.rules.resolve_language(tag)
                dialect=resolved[tag]
                if not dialect:
                    block['eligible']=False
                    unsupported.add(tag);coverage['skippedBlocks']+=1
                    continue
                block['configuration']={**config,'dialect':dialect}
                findings = self.rules.check(block["text"], block['configuration'])
                self._append(job, [shift(item, block["start"]) for item in findings])
                coverage["checkedBlocks"] += 1
                self._update(job, coverage=coverage.copy())
            if unsupported:warnings.append('No local spelling or grammar rules are available for: '+', '.join(sorted(unsupported))+'. Those passages were not checked.')
            if advanced and not self.resources.capabilities()["model"]["available"]:
                warnings.append("Advanced grammar is unavailable: install the local model pack.")
            elif advanced:
                self._update(job, stage="model", message="Waiting for advanced grammar...")
                self.advanced_pool.submit(self._advanced, job, paragraphs, config, coverage, warnings)
                return
            self._update(job, status="partial" if warnings else "completed", stage="done", warnings=warnings,
                         coverage=coverage, message="Check incomplete." if warnings else "Check complete.")
        except Exception as exc:
            # Runtime exceptions must not be rendered as a clean manuscript.
            message = str(exc) if isinstance(exc, (RuntimeError, ValidationError)) else "The local check failed. Try again or repair the proofreading pack."
            self._update(job, status="partial" if job["annotations"] else "failed", warnings=warnings + [message],
                         message="Check incomplete.")
        finally:
            if self._cancelled(job):
                self._update(job, status="cancelled", message="Check cancelled.")

    def _advanced(self, job, paragraphs, config, coverage, warnings, begin=0):
        try:
            for position in range(begin, len(paragraphs)):
                block = paragraphs[position]
                if self._cancelled(job):
                    return
                if not block['eligible']:continue
                if block['language'].lower().split('-')[0]!='en':
                    warning='Advanced grammar checks English only. Other passages use local rules where available.'
                    if block['language'].lower()!='zxx' and warning not in warnings:warnings.append(warning)
                    continue
                if self.speech_busy():
                    self.model.close()
                    self._update(job, message="Advanced grammar is waiting for narration…")
                while self.speech_busy():
                    if job["_cancel"].wait(.25) or self.closed.is_set():
                        return
                self._update(job, message="Reviewing grammar with the local model…")
                try:
                    block_config = block.get('configuration', config)
                    if config.get('task')=='revise':
                        block_config={**block_config,'acceptedWords':sorted(set(block_config['acceptedWords'])|source_identifiers(block['text']))}
                    interrupted = lambda: self.closed.is_set() or self.speech_busy() or (config.get('task') != 'revise' and self._cancelled(job))
                    corrected = self.model.check(block["text"], block_config, interrupted)
                    if config.get('task') == 'revise' and not self._cancelled(job):
                        corrected=restore_money_notation(block['text'],corrected)
                        plural_terms=narrowed_plural_terms(block['text'],corrected)
                        if plural_terms:
                            # Retry from the original message, not the narrowed
                            # draft. The existing accepted-terms prompt constrains
                            # this one repair to retain the explicit plural forms.
                            corrected=self.model.check(block['text'],{**block_config,
                                'acceptedWords':sorted(set(block_config['acceptedWords'])|plural_terms),
                                'repairReason':'plurality','pluralityTerms':sorted(plural_terms)},lambda:self._cancelled(job) or self.speech_busy())
                            corrected=restore_money_notation(block['text'],corrected)
                        if self.resources.capabilities().get('rules', {}).get('available'):
                            audit_config = {**block_config, 'acceptedWords': sorted(set(block_config['acceptedWords']) |
                                            unchanged_internal_names(block['text'], corrected))}
                            corrected = complete_spelling(corrected, audit_config, self.rules.check, self.model.check,
                                                         lambda: self._cancelled(job) or self.speech_busy(),allow_repair=not plural_terms)
                            if corrected is None:
                                warning = 'A sentence proposal was withheld because its spelling could not be verified. Word-level corrections remain available.'
                                if warning not in warnings: warnings.append(warning)
                        else:
                            warning = 'Sentence spelling verification is unavailable: the local rules pack is missing.'
                            if warning not in warnings: warnings.append(warning)
                except InterruptedError:
                    if self._cancelled(job):
                        return
                    warnings.append("Narration interrupted advanced checking. Run advanced review again to finish.")
                    break
                if self._cancelled(job):
                    return
                validator = revision if config.get('task') == 'revise' else model_correction
                item = validator(block["text"], corrected, block_config["acceptedWords"])
                if item and item["ruleId"] not in config["ignoredRuleIds"]:
                    if config.get('task') == 'revise':
                        item['preservesGenerated'] = block.get('protected',False)
                    self._append(job, [shift(item, block["start"])])
                coverage["advancedBlocks"] += 1
                self._update(job, coverage=coverage.copy())
                # Yield between passages so a whole-book job cannot monopolise
                # the model while the author requests a current-sentence edit.
                if position + 1 < len(paragraphs):
                    self.advanced_pool.submit(self._advanced, job, paragraphs, config,
                                              coverage, warnings, position + 1)
                    return
            self._update(job, status="partial" if warnings else "completed", stage="done", warnings=warnings,
                         coverage=coverage, message="Check incomplete." if warnings else "Check complete.")
        except Exception as exc:
            message = str(exc) if isinstance(exc, RuntimeError) else "Advanced grammar failed. Fast results remain available."
            self._update(job, status="partial", warnings=warnings + [message], message="Check incomplete.")
        finally:
            if self._cancelled(job):
                self._update(job, status="cancelled", message="Check cancelled.")

    def get(self, identifier):
        with self.lock:
            return self._public(self.jobs[identifier])

    def cancel(self, identifier):
        with self.lock:
            job = self.jobs[identifier]
            job["_cancel"].set()
            return self._public(job)

    def _prune(self):
        finished = [key for key, job in self.jobs.items() if job["status"] in TERMINAL]
        for key in finished[:-8]:
            del self.jobs[key]

    def _maintain(self):
        while not self.closed.wait(5):
            if self.model.process and (self.speech_busy() or time.monotonic() - self.model.last_used > 120):
                if self.model.lock.acquire(blocking=False):
                    try:
                        self.model.close()
                    finally:
                        self.model.lock.release()
            with self.lock:
                for key, job in list(self.jobs.items()):
                    if job["status"] in TERMINAL and time.monotonic() - job["_created"] > 900:
                        del self.jobs[key]

    def shutdown(self):
        self.closed.set()
        with self.lock:
            for job in self.jobs.values():
                job["_cancel"].set()
        self.model.close()
        self.rules.close()
        self.pool.shutdown(wait=True, cancel_futures=True)
        self.advanced_pool.shutdown(wait=True, cancel_futures=True)
