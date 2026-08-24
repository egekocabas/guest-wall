"""Allow photos to be added without printing."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_allow_wall_only_photos"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("photos") as batch_op:
        batch_op.alter_column("printed_at", existing_type=sa.DateTime(), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE photos SET printed_at = created_at WHERE printed_at IS NULL")
    with op.batch_alter_table("photos") as batch_op:
        batch_op.alter_column("printed_at", existing_type=sa.DateTime(), nullable=False)
