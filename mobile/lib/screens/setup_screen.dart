import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';

class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key, required this.onComplete});

  final VoidCallback onComplete;

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  bool _loading = false;
  String? _error;

  Future<void> _startFresh() async {
    setState(() {
      _error = null;
      _loading = true;
    });
    try {
      final state = context.read<AppState>();
      final api = Api(baseUrl: state.effectiveBaseUrl, token: state.token);
      await api.post('/v1/setup/complete', <String, dynamic>{});
      if (mounted) widget.onComplete();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _importFromFile() async {
    setState(() {
      _error = null;
      _loading = true;
    });
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['json'],
        withData: true,
      );
      final file = result?.files.singleOrNull;
      if (file == null || file.bytes == null) {
        if (mounted) setState(() => _loading = false);
        return;
      }
      final text = utf8.decode(file.bytes!);
      final decoded = jsonDecode(text);
      if (decoded is! Map) {
        if (mounted) setState(() {
          _error = 'Invalid export file.';
          _loading = false;
        });
        return;
      }
      final data = Map<String, dynamic>.from(decoded as Map<dynamic, dynamic>);
      final hasVersion = data.containsKey('version');
      final hasUser = data.containsKey('user');
      final hasTransactions = data.containsKey('transactions');
      if (!hasVersion && !hasUser && !hasTransactions) {
        if (mounted) setState(() {
          _error = 'Invalid export file.';
          _loading = false;
        });
        return;
      }
      final state = context.read<AppState>();
      final api = Api(baseUrl: state.effectiveBaseUrl, token: state.token);
      await api.post('/v1/import/data', data);
      await api.post('/v1/setup/complete', <String, dynamic>{});
      if (mounted) widget.onComplete();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Get started',
                style: Theme.of(context).textTheme.headlineMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                'Import your data from a backup file or start fresh.',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 32),
              if (_error != null) ...[
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.errorContainer,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    _error!,
                    style: TextStyle(
                      color: Theme.of(context).colorScheme.onErrorContainer,
                    ),
                  ),
                ),
                const SizedBox(height: 16),
              ],
              FilledButton.icon(
                onPressed: _loading ? null : _importFromFile,
                icon: _loading
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.upload_file),
                label: Text(_loading ? 'Importing…' : 'Import from backup file'),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
              ),
              const SizedBox(height: 12),
              OutlinedButton(
                onPressed: _loading ? null : _startFresh,
                style: OutlinedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: const Text('Start fresh'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
