"""
Session and logging setup via pkg_infra.

Importing this module configures the whole logging tree once, so every other
module in the package takes a plain ``logging.getLogger(__name__)`` and
inherits the pkg_infra handlers and format. The package ``__init__`` imports
it — without that import the configuration never runs.
"""

import logging

from pkg_infra.session import get_session

session = get_session(workspace = '.')

# pkg_infra leaves the root logger at WARNING. `main` asks for INFO through
# `logging.basicConfig`, which turns into a no-op once the root logger carries
# handlers, so set the level the package already expected on the package logger.
logging.getLogger(__package__).setLevel(logging.INFO)
