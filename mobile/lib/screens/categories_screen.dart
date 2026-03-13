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
  String? _error;

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
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<Map<String, dynamic>> get _topLevel => _categories.where((c) => c['parent_id'] == null).toList();

  Future<void> _addCategory() async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    final nameController = TextEditingController();
    String? parentId;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) {
          return Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('New category', style: Theme.of(ctx).textTheme.titleLarge),
                  const SizedBox(height: 16),
                  TextField(
                    controller: nameController,
                    decoration: const InputDecoration(labelText: 'Name', border: OutlineInputBorder()),
                    autofocus: true,
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String?>(
                    value: parentId,
                    decoration: const InputDecoration(labelText: 'Parent (optional)', border: OutlineInputBorder()),
                    items: [
                      const DropdownMenuItem(value: null, child: Text('None')),
                      ..._topLevel.map((c) => DropdownMenuItem(value: c['id'] as String, child: Text(c['name'] as String? ?? ''))),
                    ],
                    onChanged: (v) => setModalState(() => parentId = v),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: () async {
                          final name = nameController.text.trim();
                          if (name.isEmpty) return;
                          try {
                            final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
                            await api.post('/v1/categories', {'name': name, 'parent_id': parentId});
                            if (ctx.mounted) Navigator.pop(ctx);
                            _load();
                          } catch (e) {
                            if (ctx.mounted) ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(e.toString())));
                          }
                        },
                        child: const Text('Add'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _editCategory(Map<String, dynamic> c) async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    final nameController = TextEditingController(text: c['name'] as String? ?? '');
    var parentId = c['parent_id'] as String?;
    final id = c['id'] as String;
    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModalState) {
          final topLevel = _categories.where((x) => x['parent_id'] == null && x['id'] != id).toList();
          return Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('Edit category', style: Theme.of(ctx).textTheme.titleLarge),
                  const SizedBox(height: 16),
                  TextField(
                    controller: nameController,
                    decoration: const InputDecoration(labelText: 'Name', border: OutlineInputBorder()),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String?>(
                    value: parentId,
                    decoration: const InputDecoration(labelText: 'Parent (optional)', border: OutlineInputBorder()),
                    items: [
                      const DropdownMenuItem(value: null, child: Text('None')),
                      ...topLevel.map((x) => DropdownMenuItem(value: x['id'] as String, child: Text(x['name'] as String? ?? ''))),
                    ],
                    onChanged: (v) => setModalState(() => parentId = v),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: () async {
                          final name = nameController.text.trim();
                          if (name.isEmpty) return;
                          try {
                            final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
                            await api.patch('/v1/categories/$id', {'name': name, 'parent_id': parentId});
                            if (ctx.mounted) Navigator.pop(ctx);
                            _load();
                          } catch (e) {
                            if (ctx.mounted) ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(e.toString())));
                          }
                        },
                        child: const Text('Save'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Future<void> _deleteCategory(Map<String, dynamic> c) async {
    final count = (c['transaction_count'] as num?)?.toInt() ?? 0;
    final name = c['name'] as String? ?? 'Category';
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete category?'),
        content: Text(
          count > 0
              ? 'This category has $count transaction(s). Deleting it will permanently delete those transactions. Delete "$name"?'
              : 'Delete "$name"?',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error), child: const Text('Delete')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      final state = context.read<AppState>();
      final api = Api(baseUrl: state.effectiveBaseUrl, token: state.token);
      await api.delete('/v1/categories/${c['id']}');
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Categories')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _categories.isEmpty
              ? const Center(child: Text('No categories yet. Add one below.'))
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: _categories.length,
                    itemBuilder: (context, i) {
                      final c = _categories[i];
                      final hasParent = c['parent_id'] != null;
                      return ListTile(
                        leading: CircleAvatar(
                          child: Text((c['name'] as String? ?? '?')[0].toUpperCase()),
                        ),
                        title: Text(c['name'] as String? ?? ''),
                        subtitle: hasParent ? const Text('Sub-category') : null,
                        trailing: PopupMenuButton<String>(
                          onSelected: (v) {
                            if (v == 'edit') _editCategory(c);
                            if (v == 'delete') _deleteCategory(c);
                          },
                          itemBuilder: (_) => [
                            const PopupMenuItem(value: 'edit', child: Text('Edit')),
                            const PopupMenuItem(value: 'delete', child: Text('Delete')),
                          ],
                        ),
                        onTap: () => _editCategory(c),
                      );
                    },
                  ),
                ),
      floatingActionButton: FloatingActionButton(
        onPressed: _addCategory,
        child: const Icon(Icons.add),
      ),
    );
  }
}
