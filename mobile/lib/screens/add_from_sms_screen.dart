import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import '../sms_reader.dart';

class AddFromSmsScreen extends StatefulWidget {
  const AddFromSmsScreen({super.key});

  @override
  State<AddFromSmsScreen> createState() => _AddFromSmsScreenState();
}

class _AddFromSmsScreenState extends State<AddFromSmsScreen> {
  final _textController = TextEditingController();
  bool _loading = false;
  String? _error;
  Map<String, dynamic>? _parsed;
  bool _importingSms = false;

  /// Simple on-device extraction: amount, currency, date. No AI.
  /// Anonymize: strip numbers, keep vendor-like tokens for API.
  void _parse() {
    final text = _textController.text.trim();
    if (text.isEmpty) {
      setState(() => _error = 'Paste SMS text first');
      return;
    }
    final amountMatch = RegExp(r'(\d+(?:\.\d+)?)\s*(?:EGP|ج\.م|ج\.م\.|USD)?').firstMatch(text);
    final amount = amountMatch != null ? double.tryParse(amountMatch.group(1)!) : null;
    final currencyMatch = RegExp(r'(EGP|USD|ج\.م)', caseSensitive: false).firstMatch(text);
    final currency = currencyMatch?.group(1)?.toUpperCase() ?? 'EGP';
    if (currency.contains('ج')) {
      // ignore non-ASCII for simplicity in regex
    }
    final now = DateTime.now();
    final dateStr = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    final timeStr = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}';
    String anonymized = text
        .replaceAll(RegExp(r'\d+'), ' ')
        .replaceAll(RegExp(r'[\d.]'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    anonymized = anonymized.split(' ').where((w) => w.length > 1).take(5).join(' ');
    if (anonymized.isEmpty) anonymized = 'Unknown';

    setState(() {
      _error = amount == null ? 'Could not detect amount' : null;
      _parsed = amount != null
          ? {
              'amount': amount,
              'currency': currency.contains('ج') ? 'EGP' : currency,
              'date': dateStr,
              'time': timeStr,
              'anonymized_text': anonymized,
            }
          : null;
    });
  }

  Future<void> _submitWithIngestToken() async {
    if (_parsed == null) return;
    final state = context.read<AppState>();
    String? ingestToken = state.ingestToken;
    if (ingestToken == null || ingestToken.isEmpty) {
      final token = state.token;
      if (token == null) {
        setState(() => _error = 'Not logged in');
        return;
      }
      setState(() => _loading = true);
      try {
        final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
        final res = await api.post('/v1/users/me/ingest-token', {});
        ingestToken = res['ingest_token'] as String?;
        if (ingestToken != null) await state.setIngestToken(ingestToken);
      } on ApiException catch (e) {
        setState(() => _error = e.message);
        setState(() => _loading = false);
        return;
      }
    }
    if (ingestToken == null) {
      setState(() => _error = 'Generate ingest token in Settings first');
      return;
    }
    setState(() => _loading = true);
    try {
      await _callIngest(ingestToken);
    } on ApiException catch (e) {
      setState(() => _error = e.message);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      setState(() => _loading = false);
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
        setState(() => _parsed = null);
      }
    } catch (e) {
      if (mounted) setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _importingSms = false);
    }
  }

  Future<void> _callIngest(String ingestToken) async {
    final api = Api(baseUrl: context.read<AppState>().effectiveBaseUrl, token: ingestToken);
    await api.post('/v1/ingest/parsed', _parsed!);
    if (mounted) {
      setState(() => _parsed = null);
      _textController.clear();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Transaction added')));
      Navigator.pop(context);
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
            const Text('Paste your transaction SMS below. Amount and date will be detected.'),
            const SizedBox(height: 16),
            TextField(
              controller: _textController,
              maxLines: 5,
              decoration: const InputDecoration(
                hintText: 'e.g. تم خصم 50 ج.م من حسابك. Fawry',
                border: OutlineInputBorder(),
              ),
              onChanged: (_) => setState(() => _parsed = null),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: FilledButton(
                    onPressed: _loading ? null : _parse,
                    child: const Text('Parse'),
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
            if (_parsed != null) ...[
              const SizedBox(height: 24),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Amount: ${_parsed!['amount']} ${_parsed!['currency']}'),
                      Text('Date: ${_parsed!['date']} ${_parsed!['time']}'),
                      Text('Vendor hint: ${_parsed!['anonymized_text']}'),
                    ],
                  ),
                ),
              ),
              FilledButton(
                onPressed: _loading ? null : _submitWithIngestToken,
                child: _loading
                    ? const SizedBox(
                        height: 24,
                        width: 24,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Add transaction'),
              ),
            ],
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
