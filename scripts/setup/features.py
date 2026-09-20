"""Release capabilities are explicit, not inferred from accidentally missing files."""
from common import SetupError, read_json

MODEL_TARGETS = ('win32-x64', 'linux-x64', 'darwin-arm64')
RULES_ONLY_TARGETS = ('darwin-x64',)


def feature_plan(source, target):
    if target not in MODEL_TARGETS + RULES_ONLY_TARGETS:
        raise SetupError('ALDER_TARGET', 'No proofreading policy for '+target)
    manifest=read_json(source/'resources/manifests/proofreading.json')
    advanced=target in MODEL_TARGETS
    if advanced and target not in manifest['pythonBindings']:
        raise SetupError('ALDER_METADATA', 'Missing required advanced proofreading binding for '+target)
    return {
        'proofreading': {'rules':'required','rulesVersion':manifest['rulesVersion'],
                        'dialects':['en-AU','en-GB','en-US'],
                        'advanced':'experimental' if advanced else 'unavailable',
                        'advancedReason':('Local CPU model; human quality qualification remains outstanding.' if advanced else
                                          'No pinned Intel Mac inference runtime; local spelling/grammar rules remain available.'),
                        'downloadBytes':manifest['rules']['bytes']+(manifest['model']['bytes'] if advanced else 0)},
        'windowsNativeMenu': {'required':target=='win32-x64',
                              'buildTools':'Visual Studio C++ and Windows SDK' if target=='win32-x64' else 'not applicable'},
    }
