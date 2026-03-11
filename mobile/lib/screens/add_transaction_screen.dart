import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';

class AddTransactionScreen extends StatefulWidget {
  const AddTransactionScreen({super.key});

  @override
  State<AddTransactionScreen> createState() => _AddTransactionScreenState();
}

class _AddTransactionScreenState extends State<AddTransactionScreen> {
  final _amountController = TextEditingController();
  final _merchantController = TextEditingController();
  String? _categoryId;
  List<String> _tagIds = [];
  DateTime _date = DateTime.now();
  TimeOfDay _time = TimeOfDay.now();
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _tags = [];
  bool _loading = false;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadOptions();
  }

  @override
  void dispose() {
    _amountController.dispose();
    _merchantController.dispose();
    super.dispose();
  }

  Future<void> _loadOptions() async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    setState(() => _loading = true);
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final catRes = await api.get('/v1/categories');
      final tagRes = await api.get('/v1/tags');
      if (mounted) {
        setState(() {
          _categories = List<Map<String, dynamic>>.from(catRes['categories'] ?? []);
          _tags = List<Map<String, dynamic>>.from(tagRes['tags'] ?? []);
          _categoryId = _categories.isNotEmpty ? _categories.first['id'] : null;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid amount');
      return;
    }
    if (_categoryId == null) {
      setState(() => _error = 'Select a category');
      return;
    }
    setState(() {
      _error = null;
      _saving = true;
    });
    try {
      final state = context.read<AppState>();
      final api = Api(baseUrl: state.effectiveBaseUrl, token: state.token);
      final dateStr = '${_date.year}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}';
      final timeStr = '${_time.hour.toString().padLeft(2, '0')}:${_time.minute.toString().padLeft(2, '0')}';
      await api.post('/v1/transactions', {
        'amount': amount,
        'currency': 'EGP',
        'category_id': _categoryId,
        'date': dateStr,
        'time': timeStr,
        'tag_ids': _tagIds,
        'merchant': _merchantController.text.trim().isEmpty ? null : _merchantController.text.trim(),
        'source': 'manual',
      });
      if (mounted) Navigator.pop(context);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Add transaction')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _amountController,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                      labelText: 'Amount (EGP)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _merchantController,
                    decoration: const InputDecoration(
                      labelText: 'Merchant (optional)',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    value: _categoryId,
                    decoration: const InputDecoration(
                      labelText: 'Category',
                      border: OutlineInputBorder(),
                    ),
                    items: _categories
                        .map((c) => DropdownMenuItem(
                              value: c['id'] as String,
                              child: Text(c['name'] as String? ?? ''),
                            ))
                        .toList(),
                    onChanged: (v) => setState(() => _categoryId = v),
                  ),
                  const SizedBox(height: 16),
                  ListTile(
                    title: const Text('Date'),
                    subtitle: Text(
                      '${_date.year}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}',
                    ),
                    onTap: () async {
                      final d = await showDatePicker(
                        context: context,
                        initialDate: _date,
                        firstDate: DateTime(2020),
                        lastDate: DateTime.now().add(const Duration(days: 365)),
                      );
                      if (d != null) setState(() => _date = d);
                    },
                  ),
                  ListTile(
                    title: const Text('Time'),
                    subtitle: Text('${_time.hour.toString().padLeft(2, '0')}:${_time.minute.toString().padLeft(2, '0')}'),
                    onTap: () async {
                      final t = await showTimePicker(context: context, initialTime: _time);
                      if (t != null) setState(() => _time = t);
                    },
                  ),
                  if (_tags.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    const Text('Tags'),
                    Wrap(
                      spacing: 8,
                      children: _tags.map((tag) {
                        final id = tag['id'] as String;
                        final selected = _tagIds.contains(id);
                        return FilterChip(
                          label: Text(tag['name'] as String? ?? ''),
                          selected: selected,
                          onSelected: (v) {
                            setState(() {
                              if (v) _tagIds = [..._tagIds, id];
                              else _tagIds = _tagIds.where((x) => x != id).toList();
                            });
                          },
                        );
                      }).toList(),
                    ),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    child: _saving
                        ? const SizedBox(
                            height: 24,
                            width: 24,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Save'),
                  ),
                ],
              ),
            ),
    );
  }
}
