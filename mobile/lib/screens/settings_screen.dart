import 'dart:convert';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import '../api.dart';
import '../app_state.dart';
import 'setup_wizard_hub_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String? _exportMessage;
  String? _importMessage;
  bool _exporting = false;
  bool _importing = false;

  Future<void> _export() async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    setState(() {
      _exportMessage = null;
      _exporting = true;
    });
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final data = await api.get('/v1/users/export');
      final jsonStr = const JsonEncoder.withIndent('  ').convert(data);
      final dir = await getTemporaryDirectory();
      final date = DateTime.now().toIso8601String().substring(0, 10);
      final file = File('${dir.path}/mezan-export-$date.json');
      await file.writeAsString(jsonStr);
      await Share.shareXFiles([XFile(file.path)], text: 'Mezan export');
      if (mounted) setState(() {
        _exportMessage = 'Export shared.';
        _exporting = false;
      });
    } catch (e) {
      if (mounted) setState(() {
        _exportMessage = e.toString();
        _exporting = false;
      });
    }
  }

  Future<void> _import() async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Import data?'),
        content: const Text(
          'This will replace all your categories, tags, budgets, and transactions with the imported data. Continue?',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Import')),
        ],
      ),
    );
    if (confirm != true) return;
    setState(() {
      _importMessage = null;
      _importing = true;
    });
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['json'],
        withData: true,
      );
      final file = result?.files.singleOrNull;
      if (file == null || file.bytes == null) {
        if (mounted) setState(() => _importing = false);
        return;
      }
      final text = utf8.decode(file.bytes!);
      final decoded = jsonDecode(text);
      if (decoded is! Map) {
        if (mounted) setState(() {
          _importMessage = 'Invalid export file.';
          _importing = false;
        });
        return;
      }
      final data = Map<String, dynamic>.from(decoded as Map<dynamic, dynamic>);
      if (!data.containsKey('version') && !data.containsKey('user') && !data.containsKey('transactions')) {
        if (mounted) setState(() {
          _importMessage = 'Invalid export file.';
          _importing = false;
        });
        return;
      }
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final res = await api.post('/v1/import/data', data);
      final imported = res['imported'] as Map<String, dynamic>?;
      if (mounted) {
        setState(() => _importing = false);
        if (imported != null) {
          setState(() => _importMessage = 'Imported: ${imported['categories'] ?? 0} categories, '
              '${imported['tags'] ?? 0} tags, ${imported['budgets'] ?? 0} budgets, '
              '${imported['transactions'] ?? 0} transactions.');
        } else {
          setState(() => _importMessage = 'Import completed.');
        }
      }
    } on ApiException catch (e) {
      if (mounted) setState(() {
        _importMessage = e.message;
        _importing = false;
      });
    } catch (e) {
      if (mounted) setState(() {
        _importMessage = e.toString();
        _importing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          const ListTile(
            title: Text('Setup wizard', style: TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text('Import data, add categories, or set budgets'),
          ),
          ListTile(
            title: const Text('Open setup wizard'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SetupWizardHubScreen()),
            ),
          ),
          const Divider(),
          const ListTile(
            title: Text('Ingest token', style: TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text('For SMS Shortcuts or Share'),
          ),
          ListTile(
            title: const Text('SMS on iPhone'),
            subtitle: const Text('Get ingest token for Shortcut or Share'),
            onTap: () => _showSmsHelp(context),
          ),
          const Divider(),
          const ListTile(
            title: Text('Export / Import', style: TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text('Backup or restore your data'),
          ),
          ListTile(
            title: const Text('Export data'),
            subtitle: Text(_exportMessage ?? 'Download all data as JSON'),
            trailing: _exporting ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)) : null,
            onTap: _exporting ? null : _export,
          ),
          ListTile(
            title: const Text('Import data'),
            subtitle: Text(_importMessage ?? 'Replace data from a backup file'),
            subtitleTextStyle: _importMessage != null && _importMessage!.startsWith('Imported') ? TextStyle(color: Theme.of(context).colorScheme.primary) : null,
            trailing: _importing ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2)) : null,
            onTap: _importing ? null : _import,
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
              '4. Option D: Paste the SMS in "Add from SMS" in the app.',
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
