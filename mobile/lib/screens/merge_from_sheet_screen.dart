import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import 'merge_wizard_screen.dart';

class MergeFromSheetScreen extends StatefulWidget {
  const MergeFromSheetScreen({super.key});

  @override
  State<MergeFromSheetScreen> createState() => _MergeFromSheetScreenState();
}

class _MergeFromSheetScreenState extends State<MergeFromSheetScreen> {
  final _textController = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final text = _textController.text.trim();
    if (text.isEmpty) {
      setState(() => _error = 'Paste CSV or sheet text first');
      return;
    }
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    setState(() {
      _error = null;
      _loading = true;
    });
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final res = await api.post('/v1/import/sheet-merge-preview', {'sheet_text': text});
      final rawItems = res['items'] as List<dynamic>? ?? [];
      final items = rawItems.map((e) => MergePreviewItem.fromJson(Map<String, dynamic>.from(e as Map))).toList();
      if (!mounted) return;
      setState(() => _loading = false);
      if (items.isEmpty) {
        setState(() => _error = 'No transactions found in sheet.');
        return;
      }
      await Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => MergeWizardScreen(
            items: items,
            confirmPath: 'sheet-merge-confirm',
            resetButtonLabel: 'Paste again',
            sourceColumnLabel: 'From sheet',
            onReset: () => Navigator.pop(context),
            onResult: (result) {
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                    'Done. ${result.created} added, ${result.skipped} matched.'
                    '${result.discarded > 0 ? ' ${result.discarded} discarded.' : ''}',
                  ),
                ),
              );
            },
          ),
        ),
      );
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = e.message.contains('501') || e.message.contains('not configured')
              ? 'AI is not configured. Set OPENAI_API_KEY in the backend.'
              : e.message;
        });
      }
    } catch (e) {
      if (mounted) setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  Future<void> _pickFile() async {
    final result = await FilePicker.platform.pickFiles(
      type: FileType.any,
      withData: true,
    );
    final file = result?.files.singleOrNull;
    if (file == null || file.bytes == null) return;
    final text = utf8.decode(file.bytes!);
    _textController.text = text;
    setState(() => _error = null);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Merge from sheet')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Paste CSV or spreadsheet text. We\'ll extract transactions and match them to existing ones.',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
            const SizedBox(height: 16),
            if (_error != null) ...[
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.errorContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.onErrorContainer)),
              ),
              const SizedBox(height: 16),
            ],
            TextField(
              controller: _textController,
              maxLines: 12,
              decoration: const InputDecoration(
                hintText: 'Paste CSV or sheet content here...',
                border: OutlineInputBorder(),
                alignLabelWithHint: true,
              ),
              onChanged: (_) => setState(() => _error = null),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: _loading ? null : _pickFile,
                  icon: const Icon(Icons.upload_file),
                  label: const Text('Pick file'),
                ),
                const SizedBox(width: 12),
                FilledButton(
                  onPressed: _loading ? null : _submit,
                  child: _loading ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Preview & merge'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
