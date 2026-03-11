import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';

class TagsScreen extends StatefulWidget {
  const TagsScreen({super.key});

  @override
  State<TagsScreen> createState() => _TagsScreenState();
}

class _TagsScreenState extends State<TagsScreen> {
  List<Map<String, dynamic>> _tags = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    setState(() => _loading = true);
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final res = await api.get('/v1/tags');
      if (mounted) {
        setState(() {
          _tags = List<Map<String, dynamic>>.from(res['tags'] ?? []);
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tags')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _tags.isEmpty
              ? const Center(child: Text('No tags yet'))
              : ListView.builder(
                  itemCount: _tags.length,
                  itemBuilder: (context, i) {
                    final t = _tags[i];
                    return ListTile(
                      leading: CircleAvatar(
                        backgroundColor: Theme.of(context).colorScheme.primaryContainer,
                        child: Text((t['name'] as String? ?? '?')[0].toUpperCase()),
                      ),
                      title: Text(t['name'] as String? ?? ''),
                    );
                  },
                ),
    );
  }
}
