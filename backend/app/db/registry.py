"""Imports every module's models so Alembic autogenerate can see them.

Add one import line per module when it gets models (this file is a known merge hotspot,
keep it to one line per module).
"""

from app.db.base import Base
from app.modules.activity import models as activity_models
from app.modules.auth import models as auth_models
from app.modules.bases import models as bases_models
from app.modules.comments import models as comments_models
from app.modules.fields import models as fields_models
from app.modules.notifications import models as notifications_models
from app.modules.organizations import models as organizations_models
from app.modules.records import models as records_models
from app.modules.sheets import models as sheets_models
from app.modules.users import models as users_models
from app.modules.views import models as views_models
from app.modules.workspaces import models as workspaces_models

__all__ = [
    "Base",
    "activity_models",
    "auth_models",
    "bases_models",
    "comments_models",
    "fields_models",
    "notifications_models",
    "organizations_models",
    "records_models",
    "sheets_models",
    "users_models",
    "views_models",
    "workspaces_models",
]
