from fastapi import APIRouter

from app.api.v1 import health
from app.modules.auth.router import router as auth_router
from app.modules.bases.router import router as bases_router
from app.modules.fields.router import router as fields_router
from app.modules.organizations.router import router as departments_router
from app.modules.records.router import router as records_router
from app.modules.users.router import router as users_router
from app.modules.views.router import router as views_router
from app.modules.workspaces.router import router as workspaces_router

# Only aggregates routers. Business logic lives in app/modules/*.
api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth_router)
api_router.include_router(users_router)
api_router.include_router(departments_router)
api_router.include_router(workspaces_router)
api_router.include_router(bases_router)
api_router.include_router(fields_router)
api_router.include_router(records_router)
api_router.include_router(views_router)
