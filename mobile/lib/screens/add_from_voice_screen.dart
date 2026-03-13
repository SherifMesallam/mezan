import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import '../api.dart';
import '../app_state.dart';
import 'merge_wizard_screen.dart';

class AddFromVoiceScreen extends StatefulWidget {
  const AddFromVoiceScreen({super.key});

  @override
  State<AddFromVoiceScreen> createState() => _AddFromVoiceScreenState();
}

class _AddFromVoiceScreenState extends State<AddFromVoiceScreen> {
  final AudioRecorder _recorder = AudioRecorder();
  bool _isRecording = false;
  bool _loading = false;
  String? _error;
  String? _status;

  @override
  void dispose() {
    _recorder.dispose();
    super.dispose();
  }

  Future<String> _getRecordingPath() async {
    final dir = await getTemporaryDirectory();
    return '${dir.path}/mezan_voice_${DateTime.now().millisecondsSinceEpoch}.m4a';
  }

  Future<void> _toggleRecord() async {
    if (_loading) return;

    if (_isRecording) {
      setState(() => _status = 'Stopping…');
      try {
        final path = await _recorder.stop();
        if (!mounted) return;
        if (path != null && path.isNotEmpty) {
          await _sendAndOpenWizard(path);
        } else {
          setState(() {
            _isRecording = false;
            _status = null;
            _error = 'Recording failed (no file).';
          });
        }
      } catch (e) {
        if (mounted) {
          setState(() {
            _isRecording = false;
            _status = null;
            _error = e.toString();
          });
        }
      }
      return;
    }

    final hasPermission = await _recorder.hasPermission();
    if (!hasPermission) {
      setState(() => _error = 'Microphone permission is required to record.');
      return;
    }

    setState(() {
      _error = null;
      _status = 'Recording…';
      _isRecording = true;
    });

    try {
      final path = await _getRecordingPath();
      await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc, sampleRate: 44100), path: path);
      if (mounted) setState(() => _status = 'Recording… Tap to stop.');
    } catch (e) {
      if (mounted) {
        setState(() {
          _isRecording = false;
          _status = null;
          _error = e.toString();
        });
      }
    }
  }

  Future<void> _sendAndOpenWizard(String path) async {
    setState(() {
      _isRecording = false;
      _status = null;
      _loading = true;
      _error = null;
    });

    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) {
      setState(() {
        _loading = false;
        _error = 'Not logged in';
      });
      return;
    }

    try {
      final file = File(path);
      if (!await file.exists()) {
        setState(() {
          _loading = false;
          _error = 'Recording file not found.';
        });
        return;
      }
      final bytes = await file.readAsBytes();
      final audioBase64 = base64Encode(bytes);
      try {
        await file.delete();
      } catch (_) {}

      setState(() => _status = 'Transcribing & matching…');

      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final res = await api.post('/v1/import/voice-merge-preview', {
        'audio_base64': audioBase64,
        'mime_type': 'audio/mp4',
      });

      final rawItems = res['items'] as List<dynamic>? ?? [];
      final items = rawItems
          .map((e) => MergePreviewItem.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList();

      if (!mounted) return;
      setState(() => _loading = false);
      setState(() => _status = null);

      if (items.isEmpty) {
        setState(() => _error = 'No transactions found in the recording. Try again with amounts and merchants.');
        return;
      }

      await Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => MergeWizardScreen(
            items: items,
            confirmPath: 'voice-merge-confirm',
            resetButtonLabel: 'Record again',
            sourceColumnLabel: 'From voice',
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
        setState(() => _status = null);
        setState(() => _error = e.message.contains('501') || e.message.contains('not configured')
            ? 'AI is not configured. Set OPENAI_API_KEY in the backend.'
            : e.message);
      }
    } catch (e) {
      if (mounted) {
        setState(() => _loading = false);
        setState(() => _status = null);
        setState(() => _error = e.toString());
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add by voice')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Tap the mic, say your transaction (e.g. "50 pounds at Fawry today", "30 dollars PayPal yesterday"), then tap again to stop. We\'ll transcribe and match like SMS.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 32),
              Center(
                child: Material(
                  color: _isRecording
                      ? Theme.of(context).colorScheme.errorContainer
                      : Theme.of(context).colorScheme.primaryContainer,
                  shape: const CircleBorder(),
                  elevation: 4,
                  child: InkWell(
                    onTap: _loading ? null : _toggleRecord,
                    customBorder: const CircleBorder(),
                    child: SizedBox(
                      width: 120,
                      height: 120,
                      child: Icon(
                        _isRecording ? Icons.stop_rounded : Icons.mic,
                        size: 56,
                        color: _isRecording
                            ? Theme.of(context).colorScheme.onErrorContainer
                            : Theme.of(context).colorScheme.onPrimaryContainer,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 24),
              if (_status != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Center(
                    child: _loading
                        ? const SizedBox(
                            height: 24,
                            width: 24,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(_status!, style: Theme.of(context).textTheme.bodyMedium),
                  ),
                ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 16),
                  child: Text(
                    _error!,
                    style: TextStyle(color: Theme.of(context).colorScheme.error),
                    textAlign: TextAlign.center,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
