"""Imports every module's models so Alembic autogenerate can see them.

Add one import line per module when it gets models (this file is a known merge hotspot,
keep it to one line per module).
"""

from app.db.base import Base
from app.modules.auth import models as auth_models
from app.modules.bases import models as bases_models
from app.modules.fields import models as fields_models
from app.modules.organizations import models as organizations_models
from app.modules.records import models as records_models
from app.modules.users import models as users_models
from app.modules.views import models as views_models
from app.modules.workspaces import models as workspaces_models

__all__ = [
    "Base",
    "auth_models",
    "bases_models",
    "fields_models",
    "organizations_models",
    "records_models",
    "users_models",
    "views_models",
    "workspaces_models",
]
