#!/usr/bin/env python3
"""Normalize mortgage history exports into a clean 10-column comma-delimited CSV.

This script uses regex parsing for each data row so it can recover lines that are
space/tab separated and ensure consistent CSV output.
"""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

EXPECTED_HEADER = [
    "Transaction Date",
    "Transaction Amount",
    "Due Date",
    "Description",
    "Principal Amount",
    "Interest Amount",
    "Escrow Amount",
    "Late Charge Amount",
    "Principal Balance",
    "Escrow Balance",
]

DATE_RE = r"\d{1,2}/\d{1,2}/\d{2,4}"
MONEY_RE = r"-?\$?\d{1,3}(?:,\d{3})*\.\d{2}|-?\$?\d+\.\d{2}"
SEP_RE = r"(?:\t+|\s{2,})"

DATA_ROW_RE = re.compile(
    rf"""
    ^\s*
    ({DATE_RE}){SEP_RE}
    ({MONEY_RE}){SEP_RE}
    ({DATE_RE}){SEP_RE}
    (.*?){SEP_RE}
    ({MONEY_RE}){SEP_RE}
    ({MONEY_RE}){SEP_RE}
    ({MONEY_RE}){SEP_RE}
    ({MONEY_RE}){SEP_RE}
    ({MONEY_RE}){SEP_RE}
    ({MONEY_RE})
    \s*$
    """,
    re.VERBOSE,
)


def normalize_currency(value: str) -> str:
    """Return money values in the form $1,234.56 or -$1,234.56."""
    v = value.strip().replace(" ", "")
    sign = ""
    if v.startswith("-"):
        sign = "-"
        v = v[1:]

    if v.startswith("$"):
        v = v[1:]

    number = float(v.replace(",", ""))
    return f"{sign}${number:,.2f}"


def parse_data_row(line: str) -> list[str] | None:
    """Parse one data row and return 10 normalized fields or None if invalid."""
    match = DATA_ROW_RE.match(line)
    if not match:
        return None

    fields = list(match.groups())

    # Normalize currency fields (2 and 5-10) while preserving dates/description.
    for idx in (1, 4, 5, 6, 7, 8, 9):
        fields[idx] = normalize_currency(fields[idx])

    fields[3] = fields[3].strip()
    return fields


def parse_header_row(line: str) -> list[str]:
    """Return a cleaned 10-column header using tabs, commas, or repeated spaces."""
    raw = line.strip().lstrip("\ufeff")

    if "\t" in raw:
        parts = [p.strip() for p in raw.split("\t") if p.strip()]
    elif "," in raw:
        parts = [p.strip() for p in raw.split(",")]
    else:
        parts = [p.strip() for p in re.split(r"\s{2,}", raw) if p.strip()]

    if len(parts) == 10:
        return parts

    return EXPECTED_HEADER.copy()


def convert_file(input_path: Path, output_path: Path, strict: bool) -> tuple[int, int]:
    """Convert input file to a clean CSV and return (written_rows, skipped_rows)."""
    rows_written = 0
    rows_skipped = 0

    with input_path.open("r", encoding="utf-8-sig", newline="") as src, output_path.open(
        "w", encoding="utf-8", newline=""
    ) as dst:
        writer = csv.writer(dst, quoting=csv.QUOTE_MINIMAL)

        header_written = False

        for line_number, raw_line in enumerate(src, start=1):
            if not raw_line.strip():
                continue

            if not header_written:
                writer.writerow(parse_header_row(raw_line))
                header_written = True
                continue

            parsed = parse_data_row(raw_line)
            if parsed is None:
                rows_skipped += 1
                if strict:
                    raise ValueError(
                        f"Could not parse line {line_number}: {raw_line.rstrip()}"
                    )
                continue

            writer.writerow(parsed)
            rows_written += 1

    return rows_written, rows_skipped


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Use regex to normalize mortgage rows and write a proper comma-delimited CSV."
        )
    )
    parser.add_argument("input_csv", type=Path, help="Path to the source file")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Output CSV path (default: <input>.fixed.csv)",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail immediately when a data line does not match the expected regex.",
    )
    return parser


def main() -> int:
    args = build_arg_parser().parse_args()

    input_path = args.input_csv
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    output_path = args.output or input_path.with_suffix(".fixed.csv")

    written, skipped = convert_file(input_path, output_path, strict=args.strict)

    print(f"Wrote {written} data rows to: {output_path}")
    if skipped:
        print(f"Skipped {skipped} unparsable row(s). Use --strict to fail on first error.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
