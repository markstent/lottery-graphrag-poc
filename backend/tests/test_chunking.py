from app.datasets.util import chunk_text, split_sentences, word_count


def test_decimal_prices_and_versions_survive() -> None:
    body = (
        "Each ticket costs GBP 1.50 per line. Release 5.3.0 changed checkout, "
        "e.g. the card step. Done."
    )
    assert split_sentences(body) == [
        "Each ticket costs GBP 1.50 per line.",
        "Release 5.3.0 changed checkout, e.g. the card step.",
        "Done.",
    ]
    assert chunk_text(body) == [body]


def test_greek_and_czech_sentences_split_on_boundaries() -> None:
    body = (
        "Το Στιγμιαίο Λαχείο πωλείται στα πρακτορεία. Η τιμή είναι 1,50 EUR. "
        "Číselná loterie se losuje dvakrát týdně."
    )
    assert len(split_sentences(body)) == 3


def test_boundary_before_digit_quote_and_bracket() -> None:
    body = 'It closed. 2025 was better! "Quoted" text? (Bracketed) end. v2.1 shipped'
    assert split_sentences(body) == [
        "It closed.",
        "2025 was better!",
        '"Quoted" text?',
        "(Bracketed) end. v2.1 shipped",
    ]


def test_trailing_whitespace_is_dropped() -> None:
    assert split_sentences("One. Two.  \n") == ["One.", "Two."]


def test_windows_overlap_by_one_sentence() -> None:
    sentences = [f"Sentence number {i} has exactly six words." for i in range(10)]
    chunks = chunk_text(" ".join(sentences), max_words=20)
    assert chunks[0].endswith(sentences[1]) and chunks[1].startswith(sentences[1])
    assert all(word_count(c) <= 20 for c in chunks)
    assert sentences[9] in chunks[-1]


def test_zero_overlap_shares_nothing() -> None:
    sentences = [f"Sentence number {i} has exactly six words." for i in range(6)]
    chunks = chunk_text(" ".join(sentences), max_words=20, overlap_sentences=0)
    assert " ".join(chunks) == " ".join(sentences)


def test_oversized_sentence_is_its_own_chunk() -> None:
    long = "Long " + " ".join(["word"] * 29) + "."
    chunks = chunk_text(f"Short one. {long} Short two.", max_words=10, overlap_sentences=0)
    assert chunks == ["Short one.", long, "Short two."]


def test_empty_body_returns_body() -> None:
    assert chunk_text("") == [""]
    assert chunk_text("   ") == ["   "]
