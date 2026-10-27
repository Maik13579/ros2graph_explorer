# Copyright 2017 Open Source Robotics Foundation, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

from collections import Counter
import json
from pathlib import Path

import ament_flake8
from ament_flake8.main import format_error, generate_flake8_report
import pytest


@pytest.mark.flake8
@pytest.mark.linter
def test_flake8():
    # The upstream fork has existing violations. Match their source text rather
    # than line numbers so moving code cannot conceal a new violation. Remove
    # entries from this baseline as existing code is cleaned up.
    baseline_path = Path(__file__).with_name('flake8_baseline.json')
    baseline = Counter(json.loads(baseline_path.read_text()))
    config = Path(ament_flake8.__file__).parent / 'configuration' / 'ament_flake8.ini'
    report = generate_flake8_report(str(config), ['.'], [])
    errors = []
    for error in report.errors:
        key = f'{Path(error.filename).as_posix()}|{error.code}|{error.physical_line.strip()}'
        if baseline[key]:
            baseline[key] -= 1
        else:
            errors.append(format_error(error))
    assert not errors, 'New code style errors / warnings:\n' + '\n'.join(errors)
