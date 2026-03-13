import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import 'merge_wizard_screen.dart';

class AddFromImageScreen extends StatefulWidget {
  const AddFromImageScreen({super.key});

  @override
  State<AddFromImageScreen> createState() => _AddFromImageScreenState();
}

class _AddFromImageScreenState extends State<AddFromImageScreen> {
  bool _loading = false;
  String? _error;

  Future<void> _pickImage(ImageSource source) async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    setState(() {
      _error = null;
      _loading = true;
    });
    try {
      final picker = ImagePicker();
      final xFile = source == ImageSource.camera
          ? await picker.pickImage(source: ImageSource.camera, imageQuality: 85)
          : await picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
      if (xFile == null || !mounted) {
        if (mounted) setState(() => _loading = false);
        return;
      }
      final bytes = await xFile.readAsBytes();
      final base64 = base64Encode(bytes);
      final mimeType = xFile.mimeType ?? 'image/jpeg';
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final res = await api.post('/v1/import/image-merge-preview', {
        'image_base64': base64,
        'mime_type': mimeType,
      });
      final rawItems = res['items'] as List<dynamic>? ?? [];
      final items = rawItems.map((e) => MergePreviewItem.fromJson(Map<String, dynamic>.from(e as Map))).toList();
      if (!mounted) return;
      setState(() => _loading = false);
      if (items.isEmpty) {
        setState(() => _error = 'No transactions found in image.');
        return;
      }
      await Navigator.push<void>(
        context,
        MaterialPageRoute(
          builder: (_) => MergeWizardScreen(
            items: items,
            resetButtonLabel: 'Choose another image',
            sourceColumnLabel: 'From image',
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
              ? 'AI extraction is not configured. Set OPENAI_API_KEY in the backend.'
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Scan receipt')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Upload a receipt or bill. We\'ll extract transactions and let you confirm or add as new.',
              style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
            const SizedBox(height: 24),
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
            if (_loading) ...[
              const Center(child: CircularProgressIndicator()),
            ] else ...[
              FilledButton.icon(
                onPressed: () => _pickImage(ImageSource.gallery),
                icon: const Icon(Icons.photo_library),
                label: const Text('Choose from gallery'),
                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
              ),
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () => _pickImage(ImageSource.camera),
                icon: const Icon(Icons.camera_alt),
                label: const Text('Take photo'),
                style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
