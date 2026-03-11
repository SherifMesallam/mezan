import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';

class CategoriesScreen extends StatefulWidget {
  const CategoriesScreen({super.key});

  @override
  State<CategoriesScreen> createState() => _CategoriesScreenState();
}

class _CategoriesScreenState extends State<CategoriesScreen> {
  List<Map<String, dynamic>> _categories = [];
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
      final res = await api.get('/v1/categories');
      if (mounted) {
        setState(() {
          _categories = List<Map<String, dynamic>>.from(res['categories'] ?? []);
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
      appBar: AppBar(
        title: const Text('Categories'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView.builder(
              itemCount: _categories.length,
              itemBuilder: (context, i) {
                final c = _categories[i];
                final hasParent = c['parent_id'] != null;
                return ListTile(
                  leading: CircleAvatar(
                    child: Text((c['name'] as String? ?? '?')[0].toUpperCase()),
                  ),
                  title: Text(c['name'] as String? ?? ''),
                  subtitle: hasParent ? Text('Sub-category') : null,
                );
              },
            ),
    );
  }
}
