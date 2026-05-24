# =============================================================================
# कथा मित्र (Katha Mitra) — Database Helper Module (db.py)
# =============================================================================
# This module handles all SQLite database operations for the Katha Mitra app.
#
# Responsibilities:
#   1. Initialize the database schema (stories + emotions tables)
#   2. Seed the emotions table with the 9 Navarasa (नवरस) entries
#   3. Provide query functions for fetching emotions and stories
#
# Database file: stories.db (created in the same directory as this script)
# =============================================================================

import sqlite3
import os
import json
import random

# ---------------------------------------------------------------------------
# Database path — resolve relative to this script's directory so it works
# regardless of the working directory when the app is launched.
# ---------------------------------------------------------------------------
DB_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(DB_DIR, "stories.db")


# ===========================================================================
# SECTION 1: Database Connection Helper
# ===========================================================================

def _get_connection():
    """
    Create and return a new SQLite connection with Row factory enabled.

    Using sqlite3.Row as the row_factory allows us to access columns by name
    (like a dictionary) instead of by numeric index, making the code more
    readable and less error-prone.

    Returns:
        sqlite3.Connection: A connection object to stories.db
    """
    conn = sqlite3.connect(DB_PATH)
    # Enable dictionary-style row access (row['column_name'])
    conn.row_factory = sqlite3.Row
    return conn


# ===========================================================================
# SECTION 2: Database Initialization
# ===========================================================================

def init_db():
    """
    Initialize the database by creating tables and seeding initial data.

    This function is safe to call multiple times — it uses IF NOT EXISTS
    clauses so it won't overwrite existing data.

    Tables created:
        - stories: Holds all Hindi mythological stories with metadata
        - emotions: Holds the 9 Navarasa entries (रस) with emoji and labels

    After creating tables, it seeds the emotions table with the 9 rasas
    if the table is empty.
    """
    conn = _get_connection()
    cursor = conn.cursor()

    # -----------------------------------------------------------------------
    # Create the 'stories' table
    # -----------------------------------------------------------------------
    # Each story belongs to one rasa (emotion) and contains:
    #   - title: The story's title in Hindi
    #   - source: Origin text (e.g., "महाभारत", "रामायण")
    #   - rasa: The emotion/rasa this story represents (e.g., "वीर")
    #   - story_text: Full narrative text in Hindi
    #   - characters: JSON array of character names as a string (e.g., '["अर्जुन", "कृष्ण"]')
    #   - recall_question: Comprehension question asked after narration
    #   - correct_answer: The expected correct answer text
    #   - answer_keywords: JSON array of keyword strings for fuzzy matching
    #   - hint: Hint text shown after first wrong attempt
    #   - reflection_question: Open-ended question for character reflection
    # -----------------------------------------------------------------------
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS stories (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            title           TEXT NOT NULL,
            source          TEXT NOT NULL,
            rasa            TEXT NOT NULL,
            story_text      TEXT NOT NULL,
            characters      TEXT NOT NULL,
            recall_question TEXT NOT NULL,
            correct_answer  TEXT NOT NULL,
            answer_keywords TEXT NOT NULL,
            hint            TEXT NOT NULL,
            reflection_question TEXT NOT NULL
        )
    """)

    # -----------------------------------------------------------------------
    # Create the 'emotions' table
    # -----------------------------------------------------------------------
    # Stores the 9 Navarasa (नवरस) used as emotion categories.
    # Each entry has:
    #   - rasa: Sanskrit/Hindi name of the rasa (used as foreign key in stories)
    #   - emoji: Visual emoji representation for UI display
    #   - label_hindi: Human-readable Hindi label for the emotion
    # -----------------------------------------------------------------------
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS emotions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            rasa        TEXT NOT NULL UNIQUE,
            emoji       TEXT NOT NULL,
            label_hindi TEXT NOT NULL
        )
    """)

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS analytics_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_name TEXT NOT NULL,
            session_id TEXT NOT NULL,
            anonymous_user_id TEXT,
            screen TEXT,
            story_id INTEGER,
            duration_seconds REAL,
            metadata_json TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL
        )
    """)

    conn.commit()

    # -----------------------------------------------------------------------
    # Seed emotions table with the 9 Navarasa if it's empty
    # -----------------------------------------------------------------------
    cursor.execute("SELECT COUNT(*) as cnt FROM emotions")
    count = cursor.fetchone()["cnt"]

    if count == 0:
        _seed_emotions(cursor)
        conn.commit()

    conn.close()


# ===========================================================================
# SECTION 3: Emotions Seeding
# ===========================================================================

def _seed_emotions(cursor):
    """
    Insert the 9 Navarasa (नवरस) into the emotions table.

    The Navarasa are the nine fundamental emotions in Indian aesthetics:
        1. शृंगार (Shringara) — Love/Romance
        2. हास्य (Hasya)      — Laughter/Comedy
        3. करुण (Karuna)      — Compassion/Sorrow
        4. रौद्र (Raudra)     — Anger/Fury
        5. वीर (Veera)        — Heroism/Courage
        6. भयानक (Bhayanaka)  — Fear/Terror
        7. बीभत्स (Bibhatsa)  — Disgust/Aversion
        8. अद्भुत (Adbhuta)   — Wonder/Amazement
        9. शांत (Shanta)      — Peace/Tranquility

    Args:
        cursor: An active SQLite cursor for executing insert statements
    """
    # Define all 9 rasas as tuples of (rasa_name, emoji, hindi_label)
    navarasa = [
        ("शृंगार", "💕", "प्रेम (शृंगार)"),
        ("हास्य",  "😄", "हँसी (हास्य)"),
        ("करुण",   "😢", "करुणा (करुण)"),
        ("रौद्र",  "😠", "क्रोध (रौद्र)"),
        ("वीर",    "💪", "वीरता (वीर)"),
        ("भयानक",  "😨", "भय (भयानक)"),
        ("बीभत्स", "😤", "घृणा (बीभत्स)"),
        ("अद्भुत", "😲", "अचंभा (अद्भुत)"),
        ("शांत",   "🙏", "शांति (शांत)"),
    ]

    # Insert each rasa into the emotions table
    cursor.executemany(
        "INSERT INTO emotions (rasa, emoji, label_hindi) VALUES (?, ?, ?)",
        navarasa
    )


# ===========================================================================
# SECTION 4: Query Functions — Emotions
# ===========================================================================

def get_emotions():
    """
    Retrieve all 9 emotions (Navarasa) from the database.

    Returns:
        list[dict]: A list of dictionaries, each containing:
            - id (int): Row ID
            - rasa (str): Sanskrit name of the rasa
            - emoji (str): Emoji representation
            - label_hindi (str): Hindi display label
    """
    conn = _get_connection()
    cursor = conn.cursor()

    # Fetch all emotions ordered by their ID (insertion order = canonical order)
    cursor.execute("SELECT id, rasa, emoji, label_hindi FROM emotions ORDER BY id")
    rows = cursor.fetchall()

    # Convert sqlite3.Row objects to plain dictionaries for JSON serialization
    emotions = [dict(row) for row in rows]

    conn.close()
    return emotions


# ===========================================================================
# SECTION 5: Query Functions — Stories
# ===========================================================================

def get_story(rasa, exclude_ids=None):
    """
    Fetch a random story matching the given rasa, excluding specified IDs.

    This is used to serve a new story each time the user picks an emotion,
    while avoiding stories they've already heard in the current session.

    Args:
        rasa (str): The emotion/rasa to filter by (e.g., "वीर")
        exclude_ids (list[int], optional): Story IDs to exclude from selection.
            Defaults to an empty list.

    Returns:
        dict or None: A dictionary with all story fields if a matching story
        is found, or None if no stories are available for the given rasa
        (after exclusions).
    """
    if exclude_ids is None:
        exclude_ids = []

    conn = _get_connection()
    cursor = conn.cursor()

    # -----------------------------------------------------------------------
    # Build the query dynamically based on whether we have IDs to exclude.
    # We use parameterized queries to prevent SQL injection.
    # -----------------------------------------------------------------------
    if exclude_ids:
        # Create placeholder string like "?,?,?" for the IN clause
        placeholders = ",".join("?" for _ in exclude_ids)
        query = f"""
            SELECT * FROM stories
            WHERE rasa = ? AND id NOT IN ({placeholders})
        """
        # Parameters: rasa first, then all exclude IDs
        params = [rasa] + list(exclude_ids)
    else:
        # No exclusions — just filter by rasa
        query = "SELECT * FROM stories WHERE rasa = ?"
        params = [rasa]

    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()

    # -----------------------------------------------------------------------
    # Return a random story from the matching results, or None if empty
    # -----------------------------------------------------------------------
    if not rows:
        return None

    # Pick a random story from the available pool
    chosen = random.choice(rows)
    return dict(chosen)


def get_story_by_id(story_id):
    """
    Fetch a single story by its unique ID.

    This is used during answer validation and character reflection to
    look up the full story record including answer_keywords and characters.

    Args:
        story_id (int): The primary key ID of the story to fetch

    Returns:
        dict or None: A dictionary with all story fields if found,
        or None if no story exists with that ID.
    """
    conn = _get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM stories WHERE id = ?", (story_id,))
    row = cursor.fetchone()

    conn.close()

    # Convert to dict if found, otherwise return None
    return dict(row) if row else None


def insert_analytics_event(event):
    conn = _get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO analytics_events (
            event_name,
            session_id,
            anonymous_user_id,
            screen,
            story_id,
            duration_seconds,
            metadata_json,
            user_agent,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event["event_name"],
            event["session_id"],
            event.get("anonymous_user_id"),
            event.get("screen"),
            event.get("story_id"),
            event.get("duration_seconds"),
            json.dumps(event.get("metadata", {}), ensure_ascii=False),
            event.get("user_agent"),
            event["timestamp"],
        ),
    )
    conn.commit()
    conn.close()


def get_analytics_summary():
    conn = _get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) AS count FROM analytics_events")
    total_events = cursor.fetchone()["count"]

    cursor.execute("SELECT COUNT(DISTINCT session_id) AS count FROM analytics_events")
    total_sessions = cursor.fetchone()["count"]

    cursor.execute(
        """
        SELECT COUNT(DISTINCT anonymous_user_id) AS count
        FROM analytics_events
        WHERE anonymous_user_id IS NOT NULL AND anonymous_user_id != ''
        """
    )
    total_users = cursor.fetchone()["count"]

    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM analytics_events
        WHERE event_name = 'story_finished'
        """
    )
    stories_finished = cursor.fetchone()["count"]

    cursor.execute(
        """
        SELECT COUNT(*) AS count
        FROM analytics_events
        WHERE event_name = 'session_completed'
        """
    )
    completed_sessions = cursor.fetchone()["count"]

    cursor.execute(
        """
        SELECT AVG(duration_seconds) AS avg_duration
        FROM analytics_events
        WHERE event_name = 'session_completed' AND duration_seconds IS NOT NULL
        """
    )
    avg_duration_row = cursor.fetchone()
    avg_session_duration = round(avg_duration_row["avg_duration"] or 0, 1)

    conn.close()
    return {
        "total_events": total_events,
        "total_sessions": total_sessions,
        "total_users": total_users,
        "stories_finished": stories_finished,
        "completed_sessions": completed_sessions,
        "avg_session_duration": avg_session_duration,
    }


def get_recent_analytics_events(limit=100):
    conn = _get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT id, event_name, session_id, anonymous_user_id, screen, story_id,
               duration_seconds, metadata_json, user_agent, created_at
        FROM analytics_events
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    )
    rows = cursor.fetchall()
    conn.close()

    events = []
    for row in rows:
        item = dict(row)
        try:
            item["metadata"] = json.loads(item.pop("metadata_json") or "{}")
        except (json.JSONDecodeError, TypeError):
            item["metadata"] = {}
            item.pop("metadata_json", None)
        events.append(item)
    return events


def get_event_counts_by_name():
    conn = _get_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT event_name, COUNT(*) AS count
        FROM analytics_events
        GROUP BY event_name
        ORDER BY count DESC, event_name ASC
        """
    )
    rows = [dict(row) for row in cursor.fetchall()]
    conn.close()
    return rows
