"""Independent preflight regressions. python blender/test_covered_validation.py <fixture-dir>"""
import copy
import json
import sys
from pathlib import Path
from covered_validation import validate_covered_outdoor

files = sorted(Path(sys.argv[1]).glob('*.json'))
assert len(files) >= 8
for path in files:
    payload = json.loads(path.read_text())
    validate_covered_outdoor(payload)
    broken = copy.deepcopy(payload)
    broken['facadeGrammar']['coveredOutdoor']['sourcePlanId'] = 'old-plan'
    try:
        validate_covered_outdoor(broken)
    except ValueError:
        pass
    else:
        raise AssertionError('Stale layout accepted')
    layout = payload['facadeGrammar']['coveredOutdoor']
    if any(r['posts'] for r in layout['roofs']):
        broken = copy.deepcopy(payload)
        for roof in broken['facadeGrammar']['coveredOutdoor']['roofs']:
            roof['posts'] = []
        try:
            validate_covered_outdoor(broken)
        except ValueError:
            pass
        else:
            raise AssertionError('Unsupported porch accepted')
        broken = copy.deepcopy(payload)
        roof = next(r for r in broken['facadeGrammar']['coveredOutdoor']['roofs'] if r['posts'])
        wall = broken['buildingModel']['walls'][0]
        roof['posts'][0].update(x=wall['a']['x']-125, y=wall['a']['y']-125)
        try:
            validate_covered_outdoor(broken)
        except ValueError:
            pass
        else:
            raise AssertionError('Intersecting pillar accepted')
print(f'{len(files)} edited layouts passed, stale layouts and invalid bearings rejected')
