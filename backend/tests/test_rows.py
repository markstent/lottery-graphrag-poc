from app.datasets import rows, schema


def test_every_table_has_a_row_type_with_matching_fields() -> None:
    for table in schema.TABLE_SCHEMAS:
        row_type = rows.ROW_TYPES[table]
        assert row_type._fields == tuple(schema.column_names(table)), table  # type: ignore[attr-defined]


def test_foreign_keys_reference_existing_columns_and_tables() -> None:
    for fk in schema.FOREIGN_KEYS:
        assert fk.child_column in schema.column_names(fk.child_table), fk
        assert fk.parent_table in schema.TABLE_SCHEMAS, fk


def test_id_formats_cover_every_generated_table_with_a_sequence_id() -> None:
    for table in (
        "incidents",
        "documents",
        "support_cases",
        "sessions",
        "tickets",
        "campaigns",
        "campaign_exposures",
        "prizes",
        "draws",
    ):
        assert "{n" in schema.ID_FORMATS[table]


def test_business_concepts_is_not_a_warehouse_table() -> None:
    assert "business_concepts" not in schema.TABLE_SCHEMAS
