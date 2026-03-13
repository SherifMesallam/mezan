import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import 'categories_screen.dart';
import 'budgets_screen.dart';

/// Shown from Settings: "Run setup wizard again" — import, categories, budgets.
class SetupWizardHubScreen extends StatefulWidget {
  const SetupWizardHubScreen({super.key});

  @override
  State<SetupWizardHubScreen> createState() => _SetupWizardHubScreenState();
}

class _SetupWizardHubScreenState extends State<SetupWizardHubScreen> {
  bool _importing = false;
  String? _importError;

  Future<void> _importFromFile() async {
    setState(() {
      _importError = null;
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
          _importError = 'Invalid export file.';
          _importing = false;
        });
        return;
      }
      final data = Map<String, dynamic>.from(decoded as Map<dynamic, dynamic>);
      if (!data.containsKey('version') && !data.containsKey('user') && !data.containsKey('transactions')) {
        if (mounted) setState(() {
          _importError = 'Invalid export file.';
          _importing = false;
        });
        return;
      }
      final state = context.read<AppState>();
      final api = Api(baseUrl: state.effectiveBaseUrl, token: state.token);
      await api.post('/v1/import/data', data);
      if (mounted) {
        setState(() => _importing = false);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Import completed.')));
      }
    } on ApiException catch (e) {
      if (mounted) setState(() {
        _importError = e.message;
        _importing = false;
      });
    } catch (e) {
      if (mounted) setState(() {
        _importError = e.toString();
        _importing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Setup wizard')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Add categories, import data, or set budgets.',
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
          ),
          const SizedBox(height: 24),
          ListTile(
            leading: CircleAvatar(
              child: _importing ? const Padding(
                padding: EdgeInsets.all(12),
                child: CircularProgressIndicator(strokeWidth: 2),
              ) : const Icon(Icons.upload_file),
            ),
            title: const Text('Import from backup'),
            subtitle: Text(_importError ?? 'Restore from a Mezan export file'),
            subtitleTextStyle: _importError != null ? TextStyle(color: Theme.of(context).colorScheme.error) : null,
            onTap: _importing ? null : _importFromFile,
          ),
          const Divider(),
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.category)),
            title: const Text('Manage categories'),
            subtitle: const Text('Add, edit, or delete categories'),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const CategoriesScreen())),
          ),
          const Divider(),
          ListTile(
            leading: const CircleAvatar(child: Icon(Icons.account_balance_wallet)),
            title: const Text('Manage budgets'),
            subtitle: const Text('Set or edit monthly budgets'),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const BudgetsScreen())),
          ),
        ],
      ),
    );
  }
}
