"""Tool registry — importing this package auto-registers all tools."""

from . import (  # noqa: F401
    xjarvis_pages,  # in-app slug router — registered first so it lands in the top 32 tools
    shell,
    mac_control,
    file_io,
    web,
    clipboard,
    vision,
    calendar,
    mail,
    notifications,
    screen,
    computer_use,
    window_manager,
    browser,
    recorder,
    focus,
    standup,
    whatsapp,
    issues,
    notes_external,
    finance,
    whoop,
    claude_code,
    google,
    spotify,
    atlassian,
)
from .base import registry  # noqa: F401

__all__ = ["registry"]
