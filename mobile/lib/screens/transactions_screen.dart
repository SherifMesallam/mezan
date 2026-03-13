import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import 'add_transaction_screen.dart';

class TransactionsScreen extends StatefulWidget {
  const TransactionsScreen({super.key});

  @override
  State<TransactionsScreen> createState() => _TransactionsScreenState();
}

class _TransactionsScreenState extends State<TransactionsScreen> {
  List<Map<String, dynamic>> _transactions = [];
  bool _loading = true;
  String? _error;
  String _month = '';

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = '${now.year}-${now.month.toString().padLeft(2, '0')}';
    _load();
  }

  (String, String) _monthRange() {
    final parts = _month.split('-');
    final y = int.parse(parts[0]);
    final m = int.parse(parts[1]);
    final start = '$_month-01';
    final lastDay = DateTime(y, m + 1, 0).day;
    final end = '$_month-${lastDay.toString().padLeft(2, '0')}';
    return (start, end);
  }

  Future<void> _load() async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final (start, end) = _monthRange();
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final res = await api.get('/v1/transactions', {'from': start, 'to': end, 'limit': '500'});
      if (mounted) {
        setState(() {
          _transactions = List<Map<String, dynamic>>.from(res['transactions'] ?? []);
          _loading = false;
        });
      }
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
      appBar: AppBar(
        title: const Text('Transactions'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const AddTransactionScreen()),
            ).then((_) => _load()),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Text('Month:', style: Theme.of(context).textTheme.bodyLarge),
                const SizedBox(width: 8),
                Expanded(
                  child: _MonthPicker(
                    value: _month,
                    onChanged: (v) => setState(() {
                      _month = v;
                      _load();
                    }),
                  ),
                ),
              ],
            ),
          ),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
            ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _transactions.isEmpty
                    ? const Center(child: Text('No transactions this month'))
                    : RefreshIndicator(
                        onRefresh: _load,
                        child: ListView.builder(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          itemCount: _transactions.length,
                          itemBuilder: (context, i) {
                            final t = _transactions[i];
                            final amt = (t['amount'] as num?)?.toDouble() ?? 0;
                            final currency = (t['currency'] as String?)?.trim().toUpperCase() ?? 'EGP';
                            final egpVal = t['egp_value'] as num?;
                            final cat = t['category'] as Map?;
                            final name = cat?['name'] ?? '—';
                            return ListTile(
                              leading: CircleAvatar(
                                child: Text((name is String && name.isNotEmpty ? name[0] : '?').toUpperCase()),
                              ),
                              title: Text(t['merchant']?.toString() ?? name),
                              subtitle: Text(t['date']?.toString() ?? ''),
                              trailing: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  Text(
                                    '${amt.toStringAsFixed(2)} $currency',
                                    style: TextStyle(
                                      fontWeight: FontWeight.w600,
                                      color: Theme.of(context).colorScheme.primary,
                                    ),
                                  ),
                                  if (currency != 'EGP' && egpVal != null) ...[
                                    const SizedBox(height: 2),
                                    Text(
                                      '≈ ${egpVal.toStringAsFixed(2)} EGP',
                                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ],
                              ),
                              onTap: () => _openEdit(context, t),
                            );
                          },
                        ),
                      ),
          ),
        ],
      ),
    );
  }

  void _openEdit(BuildContext context, Map<String, dynamic> t) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => _EditTransactionSheet(
        transaction: t,
        onSaved: () {
          Navigator.pop(ctx);
          _load();
        },
        onDeleted: () {
          Navigator.pop(ctx);
          _load();
        },
      ),
    );
  }
}

class _MonthPicker extends StatelessWidget {
  const _MonthPicker({required this.value, required this.onChanged});

  final String value;
  final void Function(String) onChanged;

  @override
  Widget build(BuildContext context) {
    final months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    final now = DateTime.now();
    final items = <DropdownMenuItem<String>>[];
    for (var i = 0; i < 36; i++) {
      final d = DateTime(now.year, now.month - i, 1);
      final v = '${d.year}-${d.month.toString().padLeft(2, '0')}';
      items.add(DropdownMenuItem(value: v, child: Text('${months[d.month - 1]} ${d.year}')));
    }
    final displayValue = items.any((e) => e.value == value) ? value : items.first.value;

    return InputDecorator(
      decoration: const InputDecoration(
        border: OutlineInputBorder(),
        contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<String>(
          value: displayValue,
          isExpanded: true,
          items: items,
          onChanged: (v) => v != null ? onChanged(v) : null,
        ),
      ),
    );
  }
}

class _EditTransactionSheet extends StatefulWidget {
  const _EditTransactionSheet({
    required this.transaction,
    required this.onSaved,
    required this.onDeleted,
  });

  final Map<String, dynamic> transaction;
  final VoidCallback onSaved;
  final VoidCallback onDeleted;

  @override
  State<_EditTransactionSheet> createState() => _EditTransactionSheetState();
}

class _EditTransactionSheetState extends State<_EditTransactionSheet> {
  static const List<String> _currencyOptions = ['EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD'];
  late TextEditingController _amountController;
  late TextEditingController _merchantController;
  late TextEditingController _egpValueController;
  late String _categoryId;
  late String _currency;
  late List<String> _tagIds;
  late DateTime _date;
  late TimeOfDay _time;
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _tags = [];
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final t = widget.transaction;
    final amt = (t['amount'] as num?)?.toDouble() ?? 0;
    _amountController = TextEditingController(text: amt.toString());
    _merchantController = TextEditingController(text: t['merchant']?.toString() ?? '');
    final rawCur = (t['currency'] as String?)?.trim().toUpperCase() ?? 'EGP';
    _currency = rawCur.length >= 3 ? rawCur.substring(0, 3) : 'EGP';
    if (!_currencyOptions.contains(_currency)) _currency = 'EGP';
    final egpVal = t['egp_value'] as num?;
    _egpValueController = TextEditingController(
      text: egpVal != null ? egpVal.toString() : '',
    );
    _categoryId = t['category_id'] ?? (t['category'] as Map?)?['id'] ?? '';
    _tagIds = List<String>.from(t['tag_ids'] ?? (t['tags'] as List?)?.map((x) => (x as Map)['id'] as String).toList() ?? []);
    final dateStr = t['date']?.toString() ?? '';
    if (dateStr.length >= 10) {
      _date = DateTime(
        int.parse(dateStr.substring(0, 4)),
        int.parse(dateStr.substring(5, 7)),
        int.parse(dateStr.substring(8, 10)),
      );
    } else {
      _date = DateTime.now();
    }
    final timeStr = t['time']?.toString() ?? '00:00';
    final timeParts = timeStr.split(':');
    _time = TimeOfDay(
      hour: timeParts.isNotEmpty ? int.tryParse(timeParts[0]) ?? 0 : 0,
      minute: timeParts.length > 1 ? int.tryParse(timeParts[1]) ?? 0 : 0,
    );
    _loadOptions();
  }

  @override
  void dispose() {
    _amountController.dispose();
    _merchantController.dispose();
    _egpValueController.dispose();
    super.dispose();
  }

  Future<void> _loadOptions() async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final catRes = await api.get('/v1/categories');
      final tagRes = await api.get('/v1/tags');
      if (mounted) {
        setState(() {
          _categories = List<Map<String, dynamic>>.from(catRes['categories'] ?? []);
          _tags = List<Map<String, dynamic>>.from(tagRes['tags'] ?? []);
          if (_categoryId.isEmpty && _categories.isNotEmpty) _categoryId = _categories.first['id'] as String;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      setState(() => _error = 'Enter a valid amount');
      return;
    }
    if (_categoryId.isEmpty) {
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
      final body = <String, dynamic>{
        'amount': amount,
        'currency': _currency,
        'category_id': _categoryId,
        'date': dateStr,
        'time': timeStr,
        'tag_ids': _tagIds,
        'merchant': _merchantController.text.trim().isEmpty ? null : _merchantController.text.trim(),
      };
      if (_currency != 'EGP') {
        final egpStr = _egpValueController.text.trim();
        if (egpStr.isNotEmpty) {
          final egpNum = double.tryParse(egpStr);
          if (egpNum != null && egpNum >= 0) body['egp_value'] = egpNum;
        }
      }
      await api.patch('/v1/transactions/${widget.transaction['id']}', body);
      if (mounted) widget.onSaved();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _delete() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Delete transaction?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Delete')),
        ],
      ),
    );
    if (confirm != true) return;
    try {
      final state = context.read<AppState>();
      final api = Api(baseUrl: state.effectiveBaseUrl, token: state.token);
      await api.delete('/v1/transactions/${widget.transaction['id']}');
      if (mounted) widget.onDeleted();
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Padding(
        padding: EdgeInsets.all(48),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    return DraggableScrollableSheet(
      initialChildSize: 0.7,
      maxChildSize: 0.95,
      minChildSize: 0.5,
      expand: false,
      builder: (context, scrollController) {
        return SingleChildScrollView(
          controller: scrollController,
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Edit transaction', style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 16),
              if (_error != null) ...[
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                const SizedBox(height: 8),
              ],
              TextField(
                controller: _amountController,
                decoration: InputDecoration(
                  labelText: 'Amount ($_currency)',
                  border: const OutlineInputBorder(),
                ),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
              ),
              const SizedBox(height: 12),
              const Text('Currency', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w500)),
              const SizedBox(height: 4),
              DropdownButtonFormField<String>(
                value: _currencyOptions.contains(_currency) ? _currency : 'EGP',
                decoration: const InputDecoration(border: OutlineInputBorder()),
                items: _currencyOptions.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(),
                onChanged: (v) => setState(() => _currency = v ?? 'EGP'),
              ),
              if (_currency != 'EGP') ...[
                const SizedBox(height: 12),
                TextField(
                  controller: _egpValueController,
                  decoration: const InputDecoration(
                    labelText: 'Equivalent in EGP (optional)',
                    hintText: 'Used in totals and budgets',
                    border: OutlineInputBorder(),
                  ),
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                ),
              ],
              const SizedBox(height: 12),
              TextField(
                controller: _merchantController,
                decoration: const InputDecoration(labelText: 'Merchant', border: OutlineInputBorder()),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                value: _categories.any((c) => c['id'] == _categoryId) ? _categoryId : null,
                decoration: const InputDecoration(labelText: 'Category', border: OutlineInputBorder()),
                items: _categories.map((c) => DropdownMenuItem(value: c['id'] as String, child: Text(c['name'] as String? ?? ''))).toList(),
                onChanged: (v) => setState(() => _categoryId = v ?? ''),
              ),
              const SizedBox(height: 12),
              ListTile(
                title: const Text('Date'),
                subtitle: Text('${_date.year}-${_date.month.toString().padLeft(2, '0')}-${_date.day.toString().padLeft(2, '0')}'),
                onTap: () async {
                  final picked = await showDatePicker(context: context, initialDate: _date, firstDate: DateTime(2020), lastDate: DateTime.now().add(const Duration(days: 365)));
                  if (picked != null && mounted) setState(() => _date = picked);
                },
              ),
              ListTile(
                title: const Text('Time'),
                subtitle: Text('${_time.hour.toString().padLeft(2, '0')}:${_time.minute.toString().padLeft(2, '0')}'),
                onTap: () async {
                  final picked = await showTimePicker(context: context, initialTime: _time);
                  if (picked != null && mounted) setState(() => _time = picked);
                },
              ),
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                children: _tags.map((tag) {
                  final id = tag['id'] as String;
                  final name = tag['name'] as String? ?? '';
                  final selected = _tagIds.contains(id);
                  return FilterChip(
                    label: Text(name),
                    selected: selected,
                    onSelected: (v) => setState(() {
                      if (v) _tagIds = [..._tagIds, id]; else _tagIds = _tagIds.where((x) => x != id).toList();
                    }),
                  );
                }).toList(),
              ),
              const SizedBox(height: 24),
              Row(
                children: [
                  TextButton.icon(
                    onPressed: _saving ? null : _delete,
                    icon: const Icon(Icons.delete_outline),
                    label: const Text('Delete'),
                    style: TextButton.styleFrom(foregroundColor: Theme.of(context).colorScheme.error),
                  ),
                  const Spacer(),
                  TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: _saving ? null : _save,
                    child: _saving ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Save'),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }
}
