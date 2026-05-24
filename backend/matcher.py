# =============================================================================
# कथा मित्र (Katha Mitra) — Hindi Fuzzy String Matching Module (matcher.py)
# =============================================================================
# This module provides fuzzy matching utilities for comparing Hindi
# (Devanagari) user input against expected answers and character names.
#
# Key features:
#   - NFC normalization of all Devanagari text before comparison
#   - Removal of common Hindi filler words to focus on content words
#   - Fuzzy matching using RapidFuzz for partial string similarity
#
# Why NFC normalization?
#   Unicode allows the same Devanagari character to be represented in
#   multiple ways (composed vs decomposed forms). For example, 'की' could
#   be stored as a single codepoint or as 'क' + 'ी' separately. NFC
#   (Canonical Decomposition followed by Canonical Composition) ensures
#   a consistent representation, preventing false mismatches.
# =============================================================================

import unicodedata
from rapidfuzz import fuzz, process

# ===========================================================================
# SECTION 1: Constants — Hindi Filler Words
# ===========================================================================
# These are common Hindi function words, particles, pronouns, and auxiliary
# verbs that don't carry significant meaning for answer comparison.
# Removing them helps the fuzzy matcher focus on the important content words.
#
# Categories included:
#   - Pronouns: मुझे, मेरे, मैं, वो, वह, यह, ये
#   - Auxiliary verbs: है, था, थी, थे, हूँ, हूं
#   - Discourse markers: लगता, कि, शायद, सोचता
#   - Postpositions: में, का, की, के, ने, को, से
#   - Conjunctions: और
#   - Particles: भी, हिसाब
# ===========================================================================

FILLER_WORDS = [
    'मुझे', 'लगता', 'है', 'कि', 'शायद',
    'मेरे', 'हिसाब', 'से',
    'मैं', 'सोचता', 'हूँ', 'हूं',
    'वो', 'वह', 'यह', 'ये',
    'था', 'थी', 'थे',
    'में', 'का', 'की', 'के',
    'ने', 'को', 'से',
    'और', 'भी',
]

# Pre-compute a set for O(1) lookup during filler word removal
_FILLER_SET = set(FILLER_WORDS)


# ===========================================================================
# SECTION 2: Text Normalization
# ===========================================================================

def normalize_hindi(text):
    """
    Normalize Hindi text for fuzzy comparison.

    Processing steps:
        1. Convert to lowercase (handles any mixed-case Latin characters
           that might appear in transliterated input)
        2. Apply NFC Unicode normalization to unify Devanagari codepoints
        3. Split into words and remove common filler words
        4. Rejoin remaining content words with single spaces

    Args:
        text (str): Raw Hindi text input from the user

    Returns:
        str: Normalized text with filler words removed, suitable for
        fuzzy comparison against keywords

    Example:
        >>> normalize_hindi("मुझे लगता है कि अर्जुन ने गांडीव उठाया")
        "अर्जुन गांडीव उठाया"
    """
    # Step 1: Lowercase (mostly for any embedded Latin characters)
    text = text.lower()

    # Step 2: NFC normalization — critical for consistent Devanagari comparison
    # Without this, visually identical text might not match at the byte level
    text = unicodedata.normalize('NFC', text)

    # Step 3: Tokenize and strip filler words
    words = text.split()
    content_words = [word for word in words if word not in _FILLER_SET]

    # Step 4: Rejoin the meaningful content words
    return " ".join(content_words)


# ===========================================================================
# SECTION 3: Answer Matching
# ===========================================================================

def match_answer(user_input, answer_keywords, threshold=65):
    """
    Check if the user's answer matches any of the expected keywords.

    Uses RapidFuzz's partial_ratio for comparison, which is effective for
    cases where the user's answer contains the keyword as a substring or
    vice versa. This handles:
        - Partial answers ("अर्जुन" matching "अर्जुन ने गांडीव उठाया")
        - Minor spelling variations in Devanagari
        - Extra words around the keyword

    Algorithm:
        1. Normalize both the user input and each keyword
        2. Compute partial_ratio between normalized input and each keyword
        3. If any keyword scores above the threshold, return True

    Args:
        user_input (str): The user's raw answer text in Hindi
        answer_keywords (list[str]): List of acceptable keyword strings
            to match against (parsed from JSON array in the database)
        threshold (int, optional): Minimum similarity score (0-100) to
            consider a match. Defaults to 65, which allows for moderate
            spelling variation while avoiding false positives.

    Returns:
        bool: True if the user's answer fuzzy-matches any keyword,
        False otherwise
    """
    # Normalize the user's input once (expensive operation, do it once)
    normalized_input = normalize_hindi(user_input)

    # -----------------------------------------------------------------------
    # Compare against each keyword individually
    # We iterate rather than using process.extractOne because we want to
    # normalize each keyword with our custom normalize_hindi function
    # (which removes filler words), not just standard lowercasing.
    # -----------------------------------------------------------------------
    for keyword in answer_keywords:
        # Normalize the keyword the same way we normalize user input
        normalized_keyword = normalize_hindi(keyword)

        # Compute partial ratio — handles substring matching well
        # partial_ratio finds the best partial alignment between two strings
        score = fuzz.partial_ratio(normalized_input, normalized_keyword)

        # If any keyword matches above threshold, the answer is correct
        if score >= threshold:
            return True

    # No keyword matched above threshold — answer is incorrect
    return False


# ===========================================================================
# SECTION 4: Character Name Matching
# ===========================================================================

def match_character(user_input, characters, threshold=65):
    """
    Find the best-matching character name from the story's character list.

    This is used during the reflection phase when the user says which
    character they'd like to reflect on. The user might say the name
    slightly differently (e.g., "अर्जुन" vs "अर्जुन जी"), so we use
    fuzzy matching to find the closest match.

    Uses RapidFuzz's process.extractOne for efficient best-match extraction.

    Args:
        user_input (str): The character name spoken/typed by the user
        characters (list[str]): List of valid character names from the story
            (parsed from JSON array in the database)
        threshold (int, optional): Minimum similarity score (0-100) to
            accept a match. Defaults to 65.

    Returns:
        str or None: The matched character name from the list if a match
        is found above the threshold, or None if no character matches
        closely enough.

    Example:
        >>> match_character("अर्जुन", ["अर्जुन", "कृष्ण", "दुर्योधन"])
        "अर्जुन"
        >>> match_character("xyz", ["अर्जुन", "कृष्ण"])
        None
    """
    # Normalize the user's input for consistent comparison
    normalized_input = normalize_hindi(user_input)

    # -----------------------------------------------------------------------
    # Normalize all character names for comparison
    # We keep a mapping from normalized → original so we can return the
    # original (properly formatted) name to the frontend.
    # -----------------------------------------------------------------------
    normalized_characters = [normalize_hindi(c) for c in characters]

    # -----------------------------------------------------------------------
    # Use process.extractOne to find the single best match
    # This is more efficient than manually iterating when comparing against
    # a list. It uses fuzz.WRatio by default, which combines multiple
    # matching strategies for robust results.
    # -----------------------------------------------------------------------
    result = process.extractOne(
        normalized_input,
        normalized_characters,
        score_cutoff=threshold  # Only return if score >= threshold
    )

    # -----------------------------------------------------------------------
    # process.extractOne returns a tuple (matched_string, score, index)
    # or None if no match meets the cutoff
    # -----------------------------------------------------------------------
    if result is not None:
        matched_string, score, index = result
        # Return the original (un-normalized) character name using the index
        return characters[index]

    # No character matched above threshold
    return None
