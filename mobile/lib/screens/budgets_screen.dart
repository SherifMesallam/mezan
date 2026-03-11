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
  String _month = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = '${now.year}-${now.month.toString().padLeft(2, '0')}';
    _load();
  }

  Future<void> _load() async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    setState(() => _loading = true);
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final res = await api.get('/v1/budgets', {'month': _month});
      if (mounted) {
        setState(() {
          _budgets = List<Map<String, dynamic>>.from(res['budgets'] ?? []);
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
      appBar: AppBar(title: const Text('Budgets')),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _budgets.isEmpty
              ? const Center(child: Text('No budgets set. Set one in Settings or here.'))
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _budgets.length,
                  itemBuilder: (context, i) {
                    final b = _budgets[i];
                    final spent = (b['spent'] as num?)?.toDouble() ?? 0;
                    final amount = (b['amount'] as num?)?.toDouble() ?? 1;
                    final overspent = b['overspent'] == true;
                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      color: overspent
                          ? Theme.of(context).colorScheme.errorContainer.withValues(alpha: 0.3)
                          : null,
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              b['scope_type'] == 'total_monthly' ? 'Total monthly' : '${b['scope_type']} ${b['scope_id']}',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                            const SizedBox(height: 8),
                            LinearProgressIndicator(
                              value: amount > 0 ? (spent / amount).clamp(0.0, 1.0) : 0,
                              backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              'EGP ${spent.toStringAsFixed(2)} / ${amount.toStringAsFixed(2)}'
                              '${overspent ? ' (over)' : ''}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
