//! Cross-platform filename sanitization using a strict allowlist.
//!
//! Only `a-z`, `0-9`, `-` (hyphen), and `_` (underscore) survive in the stem.
//! All other characters are replaced with hyphens and collapsed. Extensions are
//! preserved if they look valid (1-10 alphanumeric chars after the last dot).

/// Windows reserved device names (case-insensitive).
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Maximum filename length (stem + extension).
const MAX_FILENAME_LEN: usize = 200;

/// Sanitize a single filename component for safe use on all platforms.
///
/// Pipeline:
/// 1. Strip control characters (0x00–0x1F)
/// 2. Convert to lowercase
/// 3. Split extension from stem (last `.` where suffix is 1–10 alphanumeric)
/// 4. Replace any char NOT in `[a-z0-9_]` with `-`
/// 5. Collapse consecutive hyphens (`---` → `-`)
/// 6. Trim leading/trailing hyphens, underscores, and dots from stem
/// 7. Prefix Windows reserved names (CON, PRN, etc.) with `_`
/// 8. Truncate to 200 chars preserving extension; re-trim trailing hyphens
/// 9. Return `"unnamed"` (or `"unnamed.ext"`) if empty
pub fn sanitize_filename(name: &str) -> String {
    // 1. Strip control characters (0x00–0x1F)
    let clean: String = name.chars().filter(|c| !c.is_control()).collect();

    // 2. Convert to lowercase
    let lower = clean.to_lowercase();

    // 3. Split extension from stem
    let (raw_stem, ext) = split_stem_ext(&lower);

    // 4. In stem: replace any char NOT in [a-z0-9_] with '-'
    let mapped: String = raw_stem
        .chars()
        .map(|c| {
            if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();

    // 5. Collapse consecutive hyphens
    let mut collapsed = String::with_capacity(mapped.len());
    let mut prev_hyphen = false;
    for c in mapped.chars() {
        if c == '-' {
            if !prev_hyphen {
                collapsed.push('-');
            }
            prev_hyphen = true;
        } else {
            collapsed.push(c);
            prev_hyphen = false;
        }
    }

    // 6. Trim leading/trailing hyphens, underscores, and dots from stem
    let stem = collapsed.trim_matches(['-', '_', '.']).to_string();

    // If stem is empty after cleanup, return early
    if stem.is_empty() {
        return if ext.is_empty() {
            "unnamed".to_string()
        } else {
            format!("unnamed.{}", ext)
        };
    }

    // 7. Prefix Windows reserved names
    let stem = if RESERVED_NAMES.iter().any(|r| r.eq_ignore_ascii_case(&stem)) {
        format!("_{}", stem)
    } else {
        stem
    };

    // Build result
    let mut result = if ext.is_empty() {
        stem.clone()
    } else {
        format!("{}.{}", stem, ext)
    };

    // 8. Truncate to MAX_FILENAME_LEN preserving extension; re-trim trailing hyphens
    if result.len() > MAX_FILENAME_LEN {
        if !ext.is_empty() {
            let ext_with_dot_len = ext.len() + 1;
            if ext_with_dot_len < MAX_FILENAME_LEN {
                let keep = MAX_FILENAME_LEN - ext_with_dot_len;
                let truncated: String = stem.chars().take(keep).collect();
                let trimmed = truncated.trim_end_matches(['-', '_', '.']).to_string();
                if trimmed.is_empty() {
                    result = format!("unnamed.{}", ext);
                } else {
                    result = format!("{}.{}", trimmed, ext);
                }
            } else {
                result = result.chars().take(MAX_FILENAME_LEN).collect();
            }
        } else {
            let truncated: String = result.chars().take(MAX_FILENAME_LEN).collect();
            let trimmed = truncated.trim_end_matches(['-', '_', '.']).to_string();
            result = if trimmed.is_empty() {
                "unnamed".to_string()
            } else {
                trimmed
            };
        }
    }

    result
}

/// Split a lowercased filename into (stem, extension).
/// Extension is the part after the last `.`, if it's 1–10 ASCII alphanumeric chars.
fn split_stem_ext(name: &str) -> (&str, &str) {
    if let Some(dot_pos) = name.rfind('.') {
        let suffix = &name[dot_pos + 1..];
        if !suffix.is_empty()
            && suffix.len() <= 10
            && suffix.chars().all(|c| c.is_ascii_alphanumeric())
        {
            return (&name[..dot_pos], suffix);
        }
    }
    (name, "")
}

/// Sanitize a relative path (e.g. from a ZIP entry or URL) by applying
/// [`sanitize_filename`] to each `/`-separated component.
pub fn sanitize_path_for_archive(path: &str) -> String {
    path.split('/')
        .map(|component| {
            if component.is_empty() {
                component.to_string()
            } else {
                sanitize_filename(component)
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // sanitize_filename
    // -----------------------------------------------------------------------

    #[test]
    fn test_illegal_chars_replaced_with_hyphens() {
        let result = sanitize_filename(r#"a<b>c:d"e/f\g|h?i*j"#);
        assert_eq!(result, "a-b-c-d-e-f-g-h-i-j");
    }

    #[test]
    fn test_control_chars_stripped() {
        assert_eq!(sanitize_filename("hello\x00world\x1F!"), "helloworld");
    }

    #[test]
    fn test_reserved_names_prefixed() {
        assert_eq!(sanitize_filename("CON"), "_con");
        assert_eq!(sanitize_filename("con"), "_con");
        assert_eq!(sanitize_filename("PRN.txt"), "_prn.txt");
        assert_eq!(sanitize_filename("COM1"), "_com1");
        assert_eq!(sanitize_filename("lpt9.log"), "_lpt9.log");
    }

    #[test]
    fn test_non_reserved_not_prefixed() {
        assert_eq!(sanitize_filename("CONSOLE"), "console");
        assert_eq!(sanitize_filename("contest.txt"), "contest.txt");
    }

    #[test]
    fn test_trailing_dots_and_spaces() {
        assert_eq!(sanitize_filename("file..."), "file");
        assert_eq!(sanitize_filename("file   "), "file");
        assert_eq!(sanitize_filename("file . ."), "file");
    }

    #[test]
    fn test_empty_fallback() {
        assert_eq!(sanitize_filename(""), "unnamed");
        assert_eq!(sanitize_filename("..."), "unnamed");
        assert_eq!(sanitize_filename("   "), "unnamed");
    }

    #[test]
    fn test_truncation_preserves_extension() {
        let long_name = format!("{}.mp4", "a".repeat(300));
        let result = sanitize_filename(&long_name);
        assert!(result.len() <= MAX_FILENAME_LEN);
        assert!(result.ends_with(".mp4"));
    }

    #[test]
    fn test_truncation_without_extension() {
        let long_name = "a".repeat(300);
        let result = sanitize_filename(&long_name);
        assert!(result.len() <= MAX_FILENAME_LEN);
    }

    #[test]
    fn test_normal_filename_unchanged() {
        assert_eq!(sanitize_filename("my_video.mp4"), "my_video.mp4");
        assert_eq!(
            sanitize_filename("photo-2024-01-15.jpg"),
            "photo-2024-01-15.jpg"
        );
    }

    #[test]
    fn test_real_world_video_titles() {
        assert_eq!(
            sanitize_filename("React Tutorial: Build a Full App | 2024"),
            "react-tutorial-build-a-full-app-2024"
        );
        assert_eq!(
            sanitize_filename("AC/DC - Thunderstruck"),
            "ac-dc-thunderstruck"
        );
    }

    #[test]
    fn test_unicode_replaced() {
        assert_eq!(sanitize_filename("日本語テスト.txt"), "unnamed.txt");
        assert_eq!(sanitize_filename("café résumé.pdf"), "caf-r-sum.pdf");
    }

    #[test]
    fn test_lowercase_conversion() {
        assert_eq!(sanitize_filename("MyFile.TXT"), "myfile.txt");
        assert_eq!(sanitize_filename("HELLO WORLD"), "hello-world");
    }

    #[test]
    fn test_complex_video_title() {
        assert_eq!(
            sanitize_filename(
                "The Internet's Own Boy: The Story of Aaron Swartz | full movie (2014)"
            ),
            "the-internet-s-own-boy-the-story-of-aaron-swartz-full-movie-2014"
        );
    }

    #[test]
    fn test_ampersand_and_parens() {
        assert_eq!(
            sanitize_filename("Tom & Jerry (2021).mkv"),
            "tom-jerry-2021.mkv"
        );
    }

    // -----------------------------------------------------------------------
    // sanitize_path_for_archive
    // -----------------------------------------------------------------------

    #[test]
    fn test_path_components_sanitized() {
        assert_eq!(
            sanitize_path_for_archive("docs/page:1/index.html"),
            "docs/page-1/index.html"
        );
    }

    #[test]
    fn test_path_empty_components_preserved() {
        assert_eq!(sanitize_path_for_archive("css/style.css"), "css/style.css");
    }

    #[test]
    fn test_path_with_query_chars() {
        assert_eq!(
            sanitize_path_for_archive("api/data?key=val&other=1"),
            "api/data-key-val-other-1"
        );
    }
}
