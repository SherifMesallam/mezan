import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import 'add_transaction_screen.dart';
import 'add_from_sms_screen.dart';
import 'categories_screen.dart';
import 'tags_screen.dart';
import 'charts_screen.dart';
import 'budgets_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  List<Map<String, dynamic>> _transactions = [];
  Map<String, dynamic>? _summary;
  Map<String, dynamic>? _budgetStatus;
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
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final now = DateTime.now();
      final from = '${now.year}-${now.month.toString().padLeft(2, '0')}-01';
      final to = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      final res = await api.get('/v1/transactions', {'from': from, 'to': to, 'limit': '20'});
      final budgetRes = await api.get('/v1/insights/budget-status', {'month': from.substring(0, 7)});
      if (mounted) {
        setState(() {
          _transactions = List<Map<String, dynamic>>.from(res['transactions'] ?? []);
          _budgetStatus = budgetRes;
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

  double get _monthTotal {
    double sum = 0;
    for (final t in _transactions) {
      sum += (t['amount'] as num?)?.toDouble() ?? 0;
    }
    return sum;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mezan'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SettingsScreen()),
            ).then((_) => _load()),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: _loading
            ? const Center(child: CircularProgressIndicator())
            : SingleChildScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (_error != null)
                      Card(
                        color: Theme.of(context).colorScheme.errorContainer,
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Text(_error!),
                        ),
                      ),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'This month',
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'EGP ${_monthTotal.toStringAsFixed(2)}',
                              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                            ),
                          ],
                        ),
                      ),
                    ),
                    if (_budgetStatus != null && (_budgetStatus!['budget_status'] as List).isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('Budgets', style: Theme.of(context).textTheme.titleMedium),
                          TextButton(
                            onPressed: () => Navigator.push(
                              context,
                              MaterialPageRoute(builder: (_) => const BudgetsScreen()),
                            ).then((_) => _load()),
                            child: const Text('See all'),
                          ),
                        ],
                      ),
                      ...(_budgetStatus!['budget_status'] as List).take(3).map((b) {
                        final spent = (b['spent'] as num?)?.toDouble() ?? 0;
                        final amount = (b['amount'] as num?)?.toDouble() ?? 1;
                        final overspent = b['overspent'] == true;
                        return Card(
                          margin: const EdgeInsets.only(bottom: 8),
                          color: overspent ? Theme.of(context).colorScheme.errorContainer.withValues(alpha: 0.3) : null,
                          child: ListTile(
                            title: Text(
                              b['scope_type'] == 'total_monthly' ? 'Total' : 'Scope ${b['scope_id']}',
                            ),
                            subtitle: LinearProgressIndicator(
                              value: amount > 0 ? (spent / amount).clamp(0.0, 1.0) : 0,
                              backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
                            ),
                            trailing: Text('EGP ${spent.toStringAsFixed(0)} / ${amount.toStringAsFixed(0)}'),
                          ),
                        );
                      }),
                    ],
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Recent', style: Theme.of(context).textTheme.titleMedium),
                        TextButton(
                          onPressed: () => Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => const ChartsScreen()),
                          ),
                          child: const Text('Charts'),
                        ),
                      ],
                    ),
                    if (_transactions.isEmpty)
                      const Padding(
                        padding: EdgeInsets.all(24),
                        child: Center(child: Text('No transactions yet. Add one below.')),
                      )
                    else
                      ..._transactions.take(10).map((t) {
                        final amt = (t['amount'] as num?)?.toDouble() ?? 0;
                        final cat = t['category'] as Map?;
                        final name = cat?['name'] ?? '—';
                        return ListTile(
                          leading: CircleAvatar(
                            child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?'),
                          ),
                          title: Text(t['merchant']?.toString() ?? name),
                          subtitle: Text(t['date']?.toString() ?? ''),
                          trailing: Text(
                            'EGP ${amt.toStringAsFixed(2)}',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: Theme.of(context).colorScheme.primary,
                            ),
                          ),
                        );
                      }),
                  ],
                ),
              ),
      ),
      floatingActionButton: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          FloatingActionButton.small(
            heroTag: 'sms',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const AddFromSmsScreen()),
            ).then((_) => _load()),
            child: const Icon(Icons.sms),
          ),
          const SizedBox(height: 8),
          FloatingActionButton(
            heroTag: 'add',
            onPressed: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const AddTransactionScreen()),
            ).then((_) => _load()),
            child: const Icon(Icons.add),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: 0,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home), label: 'Home'),
          NavigationDestination(icon: Icon(Icons.pie_chart), label: 'Charts'),
          NavigationDestination(icon: Icon(Icons.account_balance_wallet), label: 'Budgets'),
          NavigationDestination(icon: Icon(Icons.category), label: 'Categories'),
          NavigationDestination(icon: Icon(Icons.label), label: 'Tags'),
        ],
        onDestinationSelected: (i) {
          if (i == 1) Navigator.push(context, MaterialPageRoute(builder: (_) => const ChartsScreen()));
          if (i == 2) Navigator.push(context, MaterialPageRoute(builder: (_) => const BudgetsScreen()));
          if (i == 3) Navigator.push(context, MaterialPageRoute(builder: (_) => const CategoriesScreen()));
          if (i == 4) Navigator.push(context, MaterialPageRoute(builder: (_) => const TagsScreen()));
        },
      ),
    );
  }
}
