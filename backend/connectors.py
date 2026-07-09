#!/usr/bin/env python3
import os
"""Query OpenJarvis connector status. Prints JSON to stdout."""
import sys
import json

sys.path.insert(0, os.environ.get('OPENJARVIS_SRC', ''))

CONNECTOR_ICONS = {
    'Gmail': '📧', 'GmailIMAP': '📧', 'GDrive': '💾', 'GCalendar': '📅',
    'GContacts': '👤', 'GoogleTasks': '✅', 'Notion': '📝', 'Obsidian': '🔮',
    'Slack': '💬', 'IMessage': '💬', 'WhatsApp': '💬', 'Granola': '🎙️',
    'AppleNotes': '📋', 'AppleMusic': '🎵', 'AppleContacts': '👥',
    'AppleHealth': '❤️', 'Strava': '🏃', 'Oura': '💤', 'Spotify': '🎶',
    'Dropbox': '📦', 'GitHubNotifications': '🐙', 'HackerNews': '🔶',
    'NewsRSS': '📰', 'Weather': '🌤️',
    'Telegram': '✈️', 'YouTube': '▶️',
}

def get_connectors():
    try:
        import openjarvis.connectors
        from openjarvis.connectors._stubs import BaseConnector
    except Exception as e:
        print(json.dumps({'error': str(e)}))
        return

    result = []
    for cls in BaseConnector.__subclasses__():
        name = cls.__name__.replace('Connector', '')
        try:
            inst = cls()
            st = inst.sync_status()
            result.append({
                'name': name,
                'icon': CONNECTOR_ICONS.get(name, '🔌'),
                'connected': inst.is_connected(),
                'state': st.state,
                'items_synced': st.items_synced,
                'items_total': st.items_total,
                'last_sync': st.last_sync.isoformat() if st.last_sync else None,
                'error': st.error,
            })
        except Exception as e:
            result.append({
                'name': name,
                'icon': CONNECTOR_ICONS.get(name, '🔌'),
                'connected': False,
                'state': 'error',
                'items_synced': 0,
                'items_total': 0,
                'last_sync': None,
                'error': str(e),
            })

    print(json.dumps(result))

if __name__ == '__main__':
    get_connectors()
