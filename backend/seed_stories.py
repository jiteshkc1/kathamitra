# =============================================================================
# कथा मित्र (Katha Mitra) — Database Seeding Script (seed_stories.py)
# =============================================================================
# This standalone script reads story data from JSON files and inserts them
# into the SQLite database (stories.db).
#
# Usage:
#   python seed_stories.py
#
# Expected JSON files (looked up in this order):
#   1. stories_data.json     — single combined file (used if it exists)
#   2. stories_part1.json    — first batch of stories  \
#      stories_part2.json    — second batch of stories  > used together
#
# The script validates that:
#   - Every rasa has at least 4 stories
#   - No story has any empty/missing fields
#
# After seeding, it prints a summary of stories per rasa and per source.
# =============================================================================

import os
import sys
import json
import sqlite3
from collections import defaultdict

# ---------------------------------------------------------------------------
# Import the database module to use its init_db() and DB_PATH
# ---------------------------------------------------------------------------
import db

# ===========================================================================
# SECTION 1: Constants
# ===========================================================================

# Directory where this script and the JSON data files are located
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Minimum number of stories required per rasa for validation
MIN_STORIES_PER_RASA = 4

# Required fields that every story JSON object must contain
REQUIRED_FIELDS = [
    "title",
    "source",
    "rasa",
    "story_text",
    "characters",
    "recall_question",
    "correct_answer",
    "answer_keywords",
    "hint",
    "reflection_question",
]


# ===========================================================================
# SECTION 2: JSON Data Loading
# ===========================================================================

def load_stories():
    """
    Load story data from JSON files.

    Tries to load in the following priority order:
        1. stories_data.json — a single combined file (preferred)
        2. stories_part1.json + stories_part2.json — two-part split

    The JSON files should contain an array of story objects, each with
    all the REQUIRED_FIELDS defined above.

    Returns:
        list[dict]: A list of story dictionaries loaded from the JSON files

    Raises:
        FileNotFoundError: If neither the combined file nor both part files exist
        json.JSONDecodeError: If any JSON file is malformed
    """
    # -----------------------------------------------------------------------
    # Option 1: Try loading the single combined file first
    # -----------------------------------------------------------------------
    combined_path = os.path.join(SCRIPT_DIR, "stories_data.json")
    if os.path.exists(combined_path):
        print(f"📖 Loading stories from: stories_data.json")
        with open(combined_path, "r", encoding="utf-8") as f:
            stories = json.load(f)
        print(f"   → Loaded {len(stories)} stories from combined file")
        return stories

    # -----------------------------------------------------------------------
    # Option 2: Try loading the two-part files
    # -----------------------------------------------------------------------
    part1_path = os.path.join(SCRIPT_DIR, "stories_part1.json")
    part2_path = os.path.join(SCRIPT_DIR, "stories_part2.json")

    # Check that both part files exist
    if not os.path.exists(part1_path):
        raise FileNotFoundError(
            f"❌ Story data file not found: stories_part1.json\n"
            f"   Expected location: {part1_path}\n"
            f"   Please provide either stories_data.json or "
            f"stories_part1.json + stories_part2.json"
        )
    if not os.path.exists(part2_path):
        raise FileNotFoundError(
            f"❌ Story data file not found: stories_part2.json\n"
            f"   Expected location: {part2_path}\n"
            f"   Please provide either stories_data.json or "
            f"stories_part1.json + stories_part2.json"
        )

    # Load both parts
    print(f"📖 Loading stories from: stories_part1.json")
    with open(part1_path, "r", encoding="utf-8") as f:
        stories_part1 = json.load(f)
    print(f"   → Loaded {len(stories_part1)} stories from part 1")

    print(f"📖 Loading stories from: stories_part2.json")
    with open(part2_path, "r", encoding="utf-8") as f:
        stories_part2 = json.load(f)
    print(f"   → Loaded {len(stories_part2)} stories from part 2")

    # Combine both parts into a single list
    all_stories = stories_part1 + stories_part2
    print(f"   → Total: {len(all_stories)} stories combined")

    return all_stories


# ===========================================================================
# SECTION 3: Validation
# ===========================================================================

def validate_stories(stories):
    """
    Validate all loaded stories for completeness and coverage.

    Performs two types of validation:
        1. Field validation: Every story must have all REQUIRED_FIELDS
           and no field should be empty or whitespace-only
        2. Coverage validation: Every rasa must have at least
           MIN_STORIES_PER_RASA stories to ensure adequate variety

    Args:
        stories (list[dict]): The list of story dictionaries to validate

    Returns:
        bool: True if all validations pass, False if any issues are found

    Side effects:
        Prints validation errors and warnings to stdout
    """
    is_valid = True
    rasa_counts = defaultdict(int)

    print("\n🔍 Validating stories...")

    # -----------------------------------------------------------------------
    # Check 1: Validate each story's fields
    # -----------------------------------------------------------------------
    for index, story in enumerate(stories):
        story_label = story.get("title", f"Story #{index + 1}")

        for field in REQUIRED_FIELDS:
            # Check if the field exists
            if field not in story:
                print(f"   ❌ Missing field '{field}' in: {story_label}")
                is_valid = False
                continue

            value = story[field]

            # Check for empty strings (after stripping whitespace)
            if isinstance(value, str) and not value.strip():
                print(f"   ❌ Empty field '{field}' in: {story_label}")
                is_valid = False

            # Check for empty lists (characters and answer_keywords)
            if isinstance(value, list) and len(value) == 0:
                print(f"   ❌ Empty list for '{field}' in: {story_label}")
                is_valid = False

        # Count stories per rasa for coverage validation
        rasa = story.get("rasa", "")
        if rasa:
            rasa_counts[rasa] += 1

    # -----------------------------------------------------------------------
    # Check 2: Validate minimum coverage per rasa
    # -----------------------------------------------------------------------
    # The 9 expected rasas
    expected_rasas = [
        "शृंगार", "हास्य", "करुण", "रौद्र", "वीर",
        "भयानक", "बीभत्स", "अद्भुत", "शांत"
    ]

    for rasa in expected_rasas:
        count = rasa_counts.get(rasa, 0)
        if count < MIN_STORIES_PER_RASA:
            print(
                f"   ⚠️  Rasa '{rasa}' has only {count} stories "
                f"(minimum: {MIN_STORIES_PER_RASA})"
            )
            is_valid = False
        else:
            print(f"   ✓ Rasa '{rasa}': {count} stories")

    if is_valid:
        print("   ✅ All validations passed!")
    else:
        print("   ⚠️  Some validations failed (see warnings above)")

    return is_valid


# ===========================================================================
# SECTION 4: Database Insertion
# ===========================================================================

def insert_stories(stories):
    """
    Insert all stories into the SQLite database.

    Each story's 'characters' and 'answer_keywords' fields are converted
    to JSON strings if they are lists (the database stores them as TEXT).

    The function clears existing stories before inserting to ensure a
    clean seed (idempotent operation).

    Args:
        stories (list[dict]): The validated list of story dictionaries

    Returns:
        int: The number of stories successfully inserted
    """
    conn = sqlite3.connect(db.DB_PATH)
    cursor = conn.cursor()

    # -----------------------------------------------------------------------
    # Clear existing stories for a clean re-seed
    # This makes the script idempotent — running it multiple times
    # produces the same result
    # -----------------------------------------------------------------------
    cursor.execute("DELETE FROM stories")
    print("\n🗑️  Cleared existing stories from database")

    # -----------------------------------------------------------------------
    # Insert each story into the database
    # -----------------------------------------------------------------------
    inserted_count = 0

    for story in stories:
        # Convert list fields to JSON strings for TEXT column storage
        characters = story["characters"]
        if isinstance(characters, list):
            characters = json.dumps(characters, ensure_ascii=False)

        answer_keywords = story["answer_keywords"]
        if isinstance(answer_keywords, list):
            answer_keywords = json.dumps(answer_keywords, ensure_ascii=False)

        # Execute the INSERT statement with parameterized values
        cursor.execute(
            """
            INSERT INTO stories (
                title, source, rasa, story_text, characters,
                recall_question, correct_answer, answer_keywords,
                hint, reflection_question
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                story["title"],
                story["source"],
                story["rasa"],
                story["story_text"],
                characters,
                story["recall_question"],
                story["correct_answer"],
                answer_keywords,
                story["hint"],
                story["reflection_question"],
            )
        )
        inserted_count += 1

    # Commit all insertions in a single transaction
    conn.commit()
    conn.close()

    print(f"✅ Inserted {inserted_count} stories into database")
    return inserted_count


# ===========================================================================
# SECTION 5: Summary Report
# ===========================================================================

def print_summary(stories):
    """
    Print a detailed summary of the seeded stories.

    Displays two breakdowns:
        1. Stories per rasa (emotion) — to verify balanced coverage
        2. Stories per source — to see the distribution across texts

    Args:
        stories (list[dict]): The list of story dictionaries that were seeded
    """
    print("\n" + "=" * 60)
    print("  📊 SEEDING SUMMARY")
    print("=" * 60)

    # -----------------------------------------------------------------------
    # Count stories per rasa
    # -----------------------------------------------------------------------
    rasa_counts = defaultdict(int)
    source_counts = defaultdict(int)

    for story in stories:
        rasa_counts[story.get("rasa", "unknown")] += 1
        source_counts[story.get("source", "unknown")] += 1

    # Print rasa breakdown
    print("\n  📚 Stories per Rasa (emotion):")
    print("  " + "-" * 40)
    for rasa, count in sorted(rasa_counts.items()):
        # Create a simple bar chart for visual clarity
        bar = "█" * count
        print(f"    {rasa:10s} │ {count:3d} │ {bar}")

    # -----------------------------------------------------------------------
    # Print source breakdown
    # -----------------------------------------------------------------------
    print("\n  📖 Stories per Source:")
    print("  " + "-" * 40)
    for source, count in sorted(source_counts.items()):
        bar = "█" * count
        print(f"    {source:20s} │ {count:3d} │ {bar}")

    # Total
    print(f"\n  📊 Total stories: {len(stories)}")
    print("=" * 60)


# ===========================================================================
# SECTION 6: Main Entry Point
# ===========================================================================

def main():
    """
    Main function that orchestrates the seeding process.

    Steps:
        1. Initialize the database (create tables if needed)
        2. Load stories from JSON files
        3. Validate all stories for completeness
        4. Insert stories into the database
        5. Print a summary report
    """
    print("=" * 60)
    print("  कथा मित्र (Katha Mitra) — Story Seeding Script")
    print("=" * 60)

    # Step 1: Initialize database tables
    print("\n🔧 Initializing database...")
    db.init_db()
    print(f"   Database: {db.DB_PATH}")

    # Step 2: Load stories from JSON
    try:
        stories = load_stories()
    except FileNotFoundError as e:
        print(f"\n{e}")
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"\n❌ JSON parsing error: {e}")
        sys.exit(1)

    # Guard: Check if any stories were loaded
    if not stories:
        print("\n❌ No stories found in the JSON files!")
        sys.exit(1)

    # Step 3: Validate stories
    is_valid = validate_stories(stories)

    if not is_valid:
        # Print a warning but continue — partial data is better than no data
        print("\n⚠️  Validation issues found. Proceeding with insertion anyway...")

    # Step 4: Insert stories into the database
    insert_stories(stories)

    # Step 5: Print summary
    print_summary(stories)

    print("\n✅ Seeding complete! The database is ready for use.")


# ===========================================================================
# Allow running this script directly with: python seed_stories.py
# ===========================================================================
if __name__ == "__main__":
    main()
