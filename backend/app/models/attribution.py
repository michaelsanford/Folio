"""Who created and last changed a row.

The values are user keys (see ``AppUser.user_key``) and are filled in by the
session ``before_flush`` listener in ``app.core.actor`` from the signed-in
person, so endpoints never set them by hand. Rows written outside a request
(migrations, seeders, scripts) keep them NULL.
"""
from sqlalchemy import Column, String


class AttributedMixin:
    created_by = Column(String(128), nullable=True)
    updated_by = Column(String(128), nullable=True)
