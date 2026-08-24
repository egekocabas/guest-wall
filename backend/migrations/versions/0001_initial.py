"""Initial Guestwall schema."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "photos",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("visibility", sa.String(length=16), nullable=False),
        sa.Column("preview_path", sa.String(length=255), nullable=False),
        sa.Column("print_path", sa.String(length=255), nullable=False),
        sa.Column("print_status", sa.String(length=16), nullable=False),
        sa.Column("printed_at", sa.DateTime(), nullable=False),
        sa.Column("last_reprint_key", sa.String(length=64), nullable=True),
        sa.Column("last_reprinted_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_photos_created_at", "photos", ["created_at"])
    op.create_index("ix_photos_visibility", "photos", ["visibility"])
    op.create_table(
        "preview_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False),
        sa.Column("preview_path", sa.String(length=255), nullable=False),
        sa.Column("print_path", sa.String(length=255), nullable=False),
        sa.Column("photo_id", sa.String(length=36), nullable=True),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_preview_sessions_expires_at", "preview_sessions", ["expires_at"])
    op.create_index("ix_preview_sessions_state", "preview_sessions", ["state"])


def downgrade() -> None:
    op.drop_index("ix_preview_sessions_state", table_name="preview_sessions")
    op.drop_index("ix_preview_sessions_expires_at", table_name="preview_sessions")
    op.drop_table("preview_sessions")
    op.drop_index("ix_photos_visibility", table_name="photos")
    op.drop_index("ix_photos_created_at", table_name="photos")
    op.drop_table("photos")
