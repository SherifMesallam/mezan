import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import '../sms_reader.dart';
import 'merge_wizard_screen.dart';

class AddFromSmsScreen extends StatefulWidget {
  const AddFromSmsScreen({super.key});

  @override
  State<AddFromSmsScreen> createState() => _AddFromSmsScreenState();
}

class _AddFromSmsScreenState extends State<AddFromSmsScreen> {
  final _textController = TextEditingController();
  bool _loading = false;
  String? _error;
  bool _importingSms = false;

  /// Same flow as web: extract + match via sms-merge-preview, then show match/confirm wizard.
  /// Wizard confirm uses sms-merge-confirm (matches existing, creates new with USD→EGP).
  Future<void> _parseAndMatch() async {
    final rawText = _textController.text.trim();
    if (rawText.isEmpty) {
      setState(() => _error = 'Paste SMS text first');
      return;
    }

    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) {
      setState(() => _error = 'Not logged in');
      return;
    }

    setState(() => _loading = true);
    setState(() => _error = null);
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final res = await api.post('/v1/import/sms-merge-preview', {'raw_text': rawText});
      final rawItems = res['items'] as List<dynamic>? ?? [];
      final items = rawItems
          .map((e) => MergePreviewItem.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList();
      if (!mounted) return;
      setState(() => _loading = false);
      if (items.isEmpty) {
        setState(() => _error = 'No transactions found in the pasted text.');
        return;
      }
      await Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => MergeWizardScreen(
            items: items,
            confirmPath: 'sms-merge-confirm',
            resetButtonLabel: 'Paste again',
            sourceColumnLabel: 'From SMS',
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
        setState(() => _loading = false);
        setState(() => _error = e.message.contains('501') || e.message.contains('not configured')
            ? 'AI extraction is not configured. Set OPENAI_API_KEY in the backend.'
            : e.message);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
        setState(() => _error = e.toString());
      }
    }
  }

  Future<void> _importLastSms() async {
    setState(() => _importingSms = true);
    setState(() => _error = null);
    try {
      final body = await getLastInboxSmsBody();
      if (!mounted) return;
      if (body == null) {
        setState(() => _error = 'No SMS access or no messages. Grant READ_SMS in Settings.');
      } else {
        _textController.text = body;
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _importingSms = false);
    }
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add from SMS')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'Paste one or more transaction SMS. We\'ll extract transactions, match them to existing ones, and let you confirm or add as new.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _textController,
              maxLines: 5,
              decoration: const InputDecoration(
                hintText: 'e.g. تم خصم 50 ج.م من حسابك. Fawry',
                border: OutlineInputBorder(),
              ),
              onChanged: (_) => setState(() => _error = null),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: _loading ? null : _parseAndMatch,
                    child: _loading
                        ? const SizedBox(
                            height: 24,
                            width: 24,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Parse & match'),
                  ),
                ),
                if (Platform.isAndroid) ...[
                  const SizedBox(width: 12),
                  Expanded(
                    child: OutlinedButton(
                      onPressed: (_loading || _importingSms) ? null : _importLastSms,
                      child: _importingSms
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Import last SMS'),
                    ),
                  ),
                ],
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 16),
              Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ],
          ],
        ),
      ),
    );
  }
}
