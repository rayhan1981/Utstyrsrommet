"""
Felles helpers som nye routers kan importere trygt.
Importerer fra server.py på en måte som ikke lager sirkulær import.

Pattern: router-filer importerer `db`, `require_tenant`, `require_perm`, `_log_activity`
fra denne modulen. Når/hvis vi senere flytter mer kode ut av server.py, oppdaterer vi
bare denne én filen.

Dette er iteration-1 av server-refaktor: lager et stabilt interface mellom nye routers
og det monolittiske server.py, uten å flytte eksisterende routes.
"""
from server import (
    db,
    api,
    require_tenant,
    require_perm,
    require_feature,
    _log_activity,
    now_iso,
    new_id,
)

__all__ = [
    "db",
    "api",
    "require_tenant",
    "require_perm",
    "require_feature",
    "_log_activity",
    "now_iso",
    "new_id",
]
