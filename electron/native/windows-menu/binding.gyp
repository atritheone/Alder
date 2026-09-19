{
  "targets": [{
    "target_name": "alder_windows_menu",
    "sources": ["menu.cc"],
    "defines": ["NAPI_VERSION=8", "UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN", "NOMINMAX"],
    "libraries": ["user32.lib", "comctl32.lib", "gdi32.lib"],
    "msvs_settings": {"VCCLCompilerTool": {"AdditionalOptions": ["/std:c++20"], "ExceptionHandling": 1}}
  }]
}
