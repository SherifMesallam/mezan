import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          Consumer<AppState>(
            builder: (context, state, _) => ListTile(
              title: const Text('API base URL'),
              subtitle: Text(state.effectiveBaseUrl),
              onTap: () => _showApiUrlDialog(context, state),
            ),
          ),
          const Divider(),
          ListTile(
            title: const Text('SMS on iPhone'),
            subtitle: const Text('Get ingest token for Shortcut or Share'),
            onTap: () => _showSmsHelp(context),
          ),
          const Divider(),
          ListTile(
            title: const Text('Log out'),
            onTap: () async {
              await context.read<AppState>().logout();
              if (context.mounted) Navigator.of(context).popUntil((r) => r.isFirst);
            },
          ),
        ],
      ),
    );
  }

  void _showApiUrlDialog(BuildContext context, AppState state) {
    final controller = TextEditingController(text: state.baseUrl ?? state.effectiveBaseUrl);
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('API base URL'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: 'http://localhost:3000',
            border: OutlineInputBorder(),
          ),
          autofocus: true,
          keyboardType: TextInputType.url,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              final url = controller.text.trim();
              await state.setBaseUrl(url.isEmpty ? null : url);
              if (context.mounted) Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('API URL saved')),
              );
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  void _showSmsHelp(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (context) => Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'SMS on iPhone',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            const Text(
              '1. Option A: Create a Shortcut that sends an email to your Mezan address when you receive a message containing "EGP" or "خصم".\n'
              '2. Option B: Create a Shortcut that POSTs the message to our API using your ingest token.\n'
              '3. Option C: Share the SMS from Messages → Share → Mezan.\n'
              '4. Option E: Paste the SMS in "Add from SMS" in the app.',
            ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: () async {
                final state = context.read<AppState>();
                final token = state.token;
                if (token == null) return;
                try {
                  final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
                  final res = await api.post('/v1/users/me/ingest-token', {});
                  final ingestToken = res['ingest_token'] as String?;
                  if (ingestToken != null && context.mounted) {
                    await state.setIngestToken(ingestToken);
                    Navigator.pop(context);
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Ingest token saved. Use it for SMS ingest.')),
                    );
                  }
                } catch (_) {}
              },
              child: const Text('Generate ingest token'),
            ),
          ],
        ),
      ),
    );
  }
}
