"""rolltrace/rollstat source_id

A trace and its quantities are now keyed by the File they were computed from, so a roll can hold a
camera (trace_pnp) and a racebox estimate at once.  `idx_rollevent_roll_type_tag_timestamp` gains
`source_id` too: without it two sources writing the same landmark at the same millisecond collide.

Downgrading restores the 4-column unique event index, which fails loudly if two sources have
written the same landmark at the same millisecond -- resolve that by hand rather than losing rows.

Revision ID: c41b7e0a92d5
Revises: 5268ae951178
Create Date: 2026-08-30 19:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c41b7e0a92d5'
down_revision: Union[str, Sequence[str], None] = '5268ae951178'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BACKFILL = ("update {t} set source_id = (select f.id from file f"
            " join rollfile rf on rf.file_id = f.id"
            " where rf.roll_id = {t}.roll_id and f.type = 'trace_pnp')")


def upgrade() -> None:
    for t in ('rolltrace', 'rollstat'):
        op.add_column(t, sa.Column('source_id', sa.Integer(), nullable=True))
        op.execute(BACKFILL.format(t=t))

    with op.batch_alter_table('rolltrace', schema=None) as b:
        b.alter_column('source_id', existing_type=sa.Integer(), nullable=False)
        b.create_foreign_key('fk_rolltrace_source_id_file', 'file', ['source_id'], ['id'])
        b.create_index(b.f('ix_rolltrace_source_id'), ['source_id'], unique=False)
        b.drop_index('idx_rolltrace_roll_kind')
        b.create_index('idx_rolltrace_roll_kind_source', ['roll_id', 'kind', 'source_id'],
                       unique=True)

    with op.batch_alter_table('rollstat', schema=None) as b:
        b.alter_column('source_id', existing_type=sa.Integer(), nullable=False)
        b.create_foreign_key('fk_rollstat_source_id_file', 'file', ['source_id'], ['id'])
        b.create_index(b.f('ix_rollstat_source_id'), ['source_id'], unique=False)
        b.drop_index('idx_rollstat_roll_quantity')
        b.create_index('idx_rollstat_roll_quantity_source', ['roll_id', 'quantity', 'source_id'],
                       unique=True)

    with op.batch_alter_table('rollevent', schema=None) as b:
        b.drop_index('idx_rollevent_roll_type_tag_timestamp')
        b.create_index('idx_rollevent_roll_type_tag_timestamp',
                       ['roll_id', 'type', 'tag', 'timestamp_ms', 'source_id'], unique=True)


def downgrade() -> None:
    with op.batch_alter_table('rollevent', schema=None) as b:
        b.drop_index('idx_rollevent_roll_type_tag_timestamp')
        b.create_index('idx_rollevent_roll_type_tag_timestamp',
                       ['roll_id', 'type', 'tag', 'timestamp_ms'], unique=True)

    with op.batch_alter_table('rollstat', schema=None) as b:
        b.drop_index('idx_rollstat_roll_quantity_source')
        b.create_index('idx_rollstat_roll_quantity', ['roll_id', 'quantity'], unique=True)
        b.drop_index(b.f('ix_rollstat_source_id'))
        b.drop_constraint('fk_rollstat_source_id_file', type_='foreignkey')
        b.drop_column('source_id')

    with op.batch_alter_table('rolltrace', schema=None) as b:
        b.drop_index('idx_rolltrace_roll_kind_source')
        b.create_index('idx_rolltrace_roll_kind', ['roll_id', 'kind'], unique=True)
        b.drop_index(b.f('ix_rolltrace_source_id'))
        b.drop_constraint('fk_rolltrace_source_id_file', type_='foreignkey')
        b.drop_column('source_id')
