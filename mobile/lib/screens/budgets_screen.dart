import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';

class BudgetsScreen extends StatefulWidget {
  const BudgetsScreen({super.key});

  @override
  State<BudgetsScreen> createState() => _BudgetsScreenState();
}

class _BudgetsScreenState extends State<BudgetsScreen> {
  List<Map<String, dynamic>> _budgets = [];
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _tags = [];
  String _month = '';
  bool _loading = true;
  String _scopeType = 'total_monthly';
  String? _scopeId;
  final _amountController = TextEditingController();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = '${now.year}-${now.month.toString().padLeft(2, '0')}';
    _load();
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    setState(() => _loading = true);
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final budgetRes = await api.get('/v1/budgets', {'month': _month});
      final catRes = await api.get('/v1/categories');
      final tagRes = await api.get('/v1/tags');
      if (mounted) {
        setState(() {
          _budgets = List<Map<String, dynamic>>.from(budgetRes['budgets'] ?? []);
          _categories = List<Map<String, dynamic>>.from(catRes['categories'] ?? []);
          _tags = List<Map<String, dynamic>>.from(tagRes['tags'] ?? []);
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _setBudget() async {
    final amount = double.tryParse(_amountController.text.trim());
    if (amount == null || amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter a valid amount')));
      return;
    }
    if (_scopeType != 'total_monthly' && (_scopeId == null || _scopeId!.isEmpty)) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Select a category or tag')));
      return;
    }
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    setState(() => _saving = true);
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      await api.post('/v1/budgets', {
        'scope_type': _scopeType,
        'scope_id': _scopeType == 'total_monthly' ? null : _scopeId,
        'amount': amount,
        'currency': 'EGP',
        'month': _month,
      });
      _amountController.clear();
      setState(() => _scopeId = null);
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  String _scopeDisplay(Map<String, dynamic> b) {
    final scopeName = b['scope_name'] as String?;
    if (scopeName != null && scopeName.isNotEmpty) return scopeName;
    if (b['scope_type'] == 'total_monthly') return 'Total monthly';
    final scopeId = b['scope_id'] as String?;
    if (scopeId == null) return 'Budget';
    for (final c in _categories) {
      if (c['id'] == scopeId) return (c['name'] as String?) ?? scopeId;
    }
    for (final t in _tags) {
      if (t['id'] == scopeId) return (t['name'] as String?) ?? scopeId;
    }
    return 'Budget';
  }

  Future<void> _updateBudgetAmount(Map<String, dynamic> b) async {
    final scopeType = b['scope_type'] as String? ?? 'category';
    final scopeId = b['scope_id'] as String?;
    final currentAmount = (b['amount'] as num?)?.toDouble() ?? 0;
    final controller = TextEditingController(text: currentAmount.toString());
    final newAmount = await showDialog<double>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Edit ${_scopeDisplay(b)}'),
        content: TextField(
          controller: controller,
          decoration: const InputDecoration(labelText: 'Amount (EGP)', border: OutlineInputBorder()),
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          autofocus: true,
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () {
              final v = double.tryParse(controller.text.trim());
              if (v != null && v > 0) Navigator.pop(ctx, v);
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
    if (newAmount == null) return;
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      await api.post('/v1/budgets', {
        'scope_type': scopeType,
        'scope_id': scopeType == 'total_monthly' ? null : scopeId,
        'amount': newAmount,
        'currency': 'EGP',
        'month': _month,
      });
      _load();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  @override
  Widget build(BuildContext context) {
    final topLevel = _categories.where((c) => c['parent_id'] == null).toList();
    final allCategories = _scopeType == 'sub_category' ? _categories : topLevel;

    return Scaffold(
      appBar: AppBar(title: const Text('Budgets')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _load,
              child: SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Text('Month:', style: Theme.of(context).textTheme.bodyLarge),
                        const SizedBox(width: 8),
                        Expanded(
                          child: DropdownButtonFormField<String>(
                            value: _month,
                            decoration: const InputDecoration(
                              border: OutlineInputBorder(),
                              contentPadding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                            ),
                            items: () {
                              final now = DateTime.now();
                              final months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                              return List.generate(24, (i) {
                                final d = DateTime(now.year, now.month - i, 1);
                                final v = '${d.year}-${d.month.toString().padLeft(2, '0')}';
                                return DropdownMenuItem(value: v, child: Text('${months[d.month - 1]} ${d.year}'));
                              });
                            }(),
                            onChanged: (v) => v != null ? setState(() { _month = v; _load(); }) : null,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    Text('Set budget', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                      value: _scopeType,
                      decoration: const InputDecoration(border: OutlineInputBorder()),
                      items: const [
                        DropdownMenuItem(value: 'total_monthly', child: Text('Total monthly')),
                        DropdownMenuItem(value: 'category', child: Text('By category (top-level)')),
                        DropdownMenuItem(value: 'sub_category', child: Text('By category (any)')),
                        DropdownMenuItem(value: 'tag', child: Text('By tag')),
                      ],
                      onChanged: (v) => v != null ? setState(() { _scopeType = v; _scopeId = null; }) : null,
                    ),
                    if (_scopeType != 'total_monthly') ...[
                      const SizedBox(height: 12),
                      DropdownButtonFormField<String?>(
                        value: _scopeId,
                        decoration: InputDecoration(
                          labelText: _scopeType == 'tag' ? 'Tag' : 'Category',
                          border: const OutlineInputBorder(),
                        ),
                        items: [
                          const DropdownMenuItem(value: null, child: Text('— Select —')),
                          if (_scopeType == 'tag')
                            ..._tags.map((t) => DropdownMenuItem(value: t['id'] as String, child: Text(t['name'] as String? ?? '')))
                          else
                            ...allCategories.map((c) => DropdownMenuItem(value: c['id'] as String, child: Text(c['name'] as String? ?? ''))),
                        ],
                        onChanged: (v) => setState(() => _scopeId = v),
                      ),
                    ],
                    const SizedBox(height: 12),
                    TextField(
                      controller: _amountController,
                      decoration: const InputDecoration(labelText: 'Amount (EGP)', border: OutlineInputBorder()),
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    ),
                    const SizedBox(height: 8),
                    FilledButton(
                      onPressed: _saving ? null : _setBudget,
                      child: _saving ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Text('Set budget'),
                    ),
                    const SizedBox(height: 24),
                    Text('Current budgets', style: Theme.of(context).textTheme.titleMedium),
                    const SizedBox(height: 8),
                    if (_budgets.isEmpty)
                      const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('No budgets set for this month.')))
                    else
                      ..._budgets.map((b) {
                        final spent = (b['spent'] as num?)?.toDouble() ?? 0;
                        final amount = (b['amount'] as num?)?.toDouble() ?? 1;
                        final overspent = b['overspent'] == true;
                        final label = _scopeDisplay(b);
                        return Card(
                          margin: const EdgeInsets.only(bottom: 12),
                          color: overspent ? Theme.of(context).colorScheme.errorContainer.withValues(alpha: 0.3) : null,
                          child: ListTile(
                            title: Text(label, style: Theme.of(context).textTheme.titleSmall),
                            subtitle: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                const SizedBox(height: 4),
                                LinearProgressIndicator(
                                  value: amount > 0 ? (spent / amount).clamp(0.0, 1.0) : 0,
                                  backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'EGP ${spent.toStringAsFixed(2)} / ${amount.toStringAsFixed(2)}${overspent ? ' (over)' : ''}',
                                  style: Theme.of(context).textTheme.bodySmall,
                                ),
                              ],
                            ),
                            trailing: IconButton(
                              icon: const Icon(Icons.edit),
                              onPressed: () => _updateBudgetAmount(b),
                            ),
                          ),
                        );
                      }),
                  ],
                ),
              ),
            ),
    );
  }
}
