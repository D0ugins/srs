"""split rollfile into file and association table

Revision ID: 9c2d4f1a7b3c
Revises: 
Create Date: 2026-05-26 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "9c2d4f1a7b3c"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "file",
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("type", sa.String(), nullable=False),
        sa.Column("uri", sa.String(), nullable=False),
        sa.Column("sensor_id", sa.Integer(), sa.ForeignKey("sensor.id"), nullable=True),
    )
    op.create_index("ix_file_type", "file", ["type"], unique=False)
    op.create_index("ix_file_sensor_id", "file", ["sensor_id"], unique=False)
    op.create_index("idx_file_type_uri_sensor", "file", ["type", "uri", "sensor_id"], unique=True)

    op.add_column("rollfile", sa.Column("file_id", sa.Integer(), nullable=True))
    op.drop_index("idx_rollfile_roll_type_uri", table_name="rollfile")
    op.drop_index("ix_rollfile_type", table_name="rollfile")

    op.execute(
        sa.text(
            """
            INSERT INTO file (created_at, updated_at, type, uri, sensor_id)
            SELECT MIN(created_at), MIN(updated_at), type, uri, sensor_id
            FROM rollfile
            GROUP BY type, uri, sensor_id
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE rollfile
            SET file_id = (
                SELECT file.id
                FROM file
                WHERE file.type = rollfile.type
                  AND file.uri = rollfile.uri
                  AND COALESCE(file.sensor_id, -1) = COALESCE(rollfile.sensor_id, -1)
                LIMIT 1
            )
            """
        )
    )

    with op.batch_alter_table("rollfile") as batch:
        batch.alter_column("file_id", nullable=False)
        batch.create_foreign_key("fk_rollfile_file_id_file", "file", ["file_id"], ["id"])
        batch.drop_column("type")
        batch.drop_column("uri")
        batch.drop_column("sensor_id")

    op.create_index("ix_rollfile_file_id", "rollfile", ["file_id"], unique=False)
    op.create_index("idx_rollfile_roll_file", "rollfile", ["roll_id", "file_id"], unique=True)


def downgrade() -> None:
    op.add_column("rollfile", sa.Column("type", sa.String(), nullable=True))
    op.add_column("rollfile", sa.Column("uri", sa.String(), nullable=True))
    op.add_column("rollfile", sa.Column("sensor_id", sa.Integer(), nullable=True))

    op.execute(
        sa.text(
            """
            UPDATE rollfile
            SET type = (SELECT file.type FROM file WHERE file.id = rollfile.file_id),
                uri = (SELECT file.uri FROM file WHERE file.id = rollfile.file_id),
                sensor_id = (SELECT file.sensor_id FROM file WHERE file.id = rollfile.file_id)
            """
        )
    )

    op.drop_index("idx_rollfile_roll_file", table_name="rollfile")
    op.drop_index("ix_rollfile_file_id", table_name="rollfile")

    with op.batch_alter_table("rollfile") as batch:
        batch.alter_column("type", nullable=False)
        batch.alter_column("uri", nullable=False)
        batch.drop_constraint("fk_rollfile_file_id_file", type_="foreignkey")
        batch.drop_column("file_id")

    op.create_index("ix_rollfile_type", "rollfile", ["type"], unique=False)
    op.create_index("idx_rollfile_roll_type_uri", "rollfile", ["roll_id", "type", "uri"], unique=True)

    op.drop_index("idx_file_type_uri_sensor", table_name="file")
    op.drop_index("ix_file_sensor_id", table_name="file")
    op.drop_index("ix_file_type", table_name="file")
    op.drop_table("file")