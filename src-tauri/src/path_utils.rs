//! Shared filename/path sanitization for Windows compatibility.
//!
//! Windows forbids `< > : " / \ | ? *` and control characters in filenames.
//! These utilities ensure external data (video titles, URLs, torrent names,
//! ZIP entries, remote filenames) never cause OS error 123 (`ERROR_INVALID_NAME`).

/// Windows reserved device names (case-insensitive).
const RESERVED_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Maximum filename length (leaving room for extension).
const MAX_FILENAME_LEN: usize = 200;

/// Sanitize a single filename component for safe use on all platforms.
///
/// - Replaces Windows-illegal characters (`< > : " / \ | ? *`) with `_`
/// - Strips control characters (0x00–0x1F)
/// - Removes trailing dots and spaces (Windows ignores them, causing confusion)
/// - Prefixes Windows reserved names (CON, PRN, etc.) with `_`
/// - Truncates to 200 chars while preserving the file extension
/// - Returns `"unnamed"` if the result would be empty
pub fn sanitize_filename(name: &str) -> String {
    let mut result = String::with_capacity(name.len());

    for ch in name.chars() {
        if ch.is_control() {
            continue;
        }
        match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => result.push('_'),
            _ => result.push(ch),
        }
    }

    // Remove trailing dots and spaces
    let trimmed = result.trim_end_matches(['.', ' ']);
    let mut result = trimmed.to_string();

    // Handle reserved names (check the stem without extension)
    let stem = if let Some(dot_pos) = result.rfind('.') {
        &result[..dot_pos]
    } else {
        &result
    };
    if RESERVED_NAMES.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
        result = format!("_{}", result);
    }

    // Truncate while preserving extension
    if result.len() > MAX_FILENAME_LEN {
        if let Some(dot_pos) = result.rfind('.') {
            let ext = &result[dot_pos..];
            if ext.len() < MAX_FILENAME_LEN {
                let keep = MAX_FILENAME_LEN - ext.len();
                let stem: String = result.chars().take(keep).collect();
                result = format!("{}{}", stem.trim_end(), ext);
            } else {
                result = result.chars().take(MAX_FILENAME_LEN).collect();
            }
        } else {
            result = result.chars().take(MAX_FILENAME_LEN).collect();
        }
    }

    if result.is_empty() {
        "unnamed".to_string()
    } else {
        result
    }
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
    fn test_illegal_chars_replaced() {
        let result = sanitize_filename(r#"a<b>c:d"e/f\g|h?i*j"#);
        assert_eq!(result, "a_b_c_d_e_f_g_h_i_j");
    }

    #[test]
    fn test_control_chars_stripped() {
        assert_eq!(sanitize_filename("hello\x00world\x1F!"), "helloworld!");
    }

    #[test]
    fn test_reserved_names_prefixed() {
        assert_eq!(sanitize_filename("CON"), "_CON");
        assert_eq!(sanitize_filename("con"), "_con");
        assert_eq!(sanitize_filename("PRN.txt"), "_PRN.txt");
        assert_eq!(sanitize_filename("COM1"), "_COM1");
        assert_eq!(sanitize_filename("lpt9.log"), "_lpt9.log");
    }

    #[test]
    fn test_non_reserved_not_prefixed() {
        assert_eq!(sanitize_filename("CONSOLE"), "CONSOLE");
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
        assert_eq!(result.len(), MAX_FILENAME_LEN);
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
        // YouTube titles often contain colons and pipes
        assert_eq!(
            sanitize_filename("React Tutorial: Build a Full App | 2024"),
            "React Tutorial_ Build a Full App _ 2024"
        );
        // Slashes in titles
        assert_eq!(
            sanitize_filename("AC/DC - Thunderstruck"),
            "AC_DC - Thunderstruck"
        );
    }

    #[test]
    fn test_unicode_preserved() {
        assert_eq!(sanitize_filename("日本語テスト.txt"), "日本語テスト.txt");
        assert_eq!(sanitize_filename("café résumé.pdf"), "café résumé.pdf");
    }

    // -----------------------------------------------------------------------
    // sanitize_path_for_archive
    // -----------------------------------------------------------------------

    #[test]
    fn test_path_components_sanitized() {
        assert_eq!(
            sanitize_path_for_archive("docs/page:1/index.html"),
            "docs/page_1/index.html"
        );
    }

    #[test]
    fn test_path_empty_components_preserved() {
        // Leading slash produces empty first component
        assert_eq!(sanitize_path_for_archive("css/style.css"), "css/style.css");
    }

    #[test]
    fn test_path_with_query_chars() {
        assert_eq!(
            sanitize_path_for_archive("api/data?key=val&other=1"),
            "api/data_key=val&other=1"
        );
    }
}
