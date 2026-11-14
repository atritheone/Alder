"""Apply bounded JSON corrections to an owned saved snapshot, then fully validate.

No filesystem paths, Python attributes or executable operations are accepted.
The normal Store.update revision check remains the sole commit boundary.
"""
from .models import ValidationError


def apply_project_changes(project, changes):
    if not isinstance(changes, list) or len(changes) > 64:
        raise ValidationError('An incremental save accepts at most 64 changes.')
    for change in changes:
        if not isinstance(change, dict): raise ValidationError('Invalid project change.')
        path = change.get('path')
        if not isinstance(path, list) or not 1 <= len(path) <= 64:
            raise ValidationError('Invalid project change path.')
        if type(change.get('remove', False)) is not bool or ('value' not in change and not change.get('remove')):
            raise ValidationError('A project change requires a value or removal.')
        parent = project
        for index, key in enumerate(path):
            if isinstance(parent, dict):
                if not isinstance(key, str): raise ValidationError('Project object keys must be strings.')
            elif isinstance(parent, list):
                if type(key) is not int or not 0 <= key < len(parent): raise ValidationError('Project array index is out of range.')
            else: raise ValidationError('Project change parent is not a container.')
            if index < len(path) - 1:
                if isinstance(parent, dict) and key not in parent: raise ValidationError('Project change parent does not exist.')
                parent = parent[key]
            elif change.get('remove'):
                if not isinstance(parent, dict) or key not in parent: raise ValidationError('Only existing project properties can be removed.')
                del parent[key]
            else:
                parent[key] = change['value']
    return project
