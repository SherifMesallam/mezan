import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:fl_chart/fl_chart.dart';
import '../api.dart';
import '../app_state.dart';
import 'add_transaction_screen.dart';
import 'add_from_sms_screen.dart';
import 'categories_screen.dart';
import 'tags_screen.dart';
import 'charts_screen.dart';
import 'add_from_image_screen.dart';
import 'merge_from_sheet_screen.dart';
import 'budgets_screen.dart';
import 'settings_screen.dart';
import 'setup_wizard_hub_screen.dart';
import 'transactions_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

const _chartColors = [
  Color(0xFF0d9b9e),
  Color(0xFF2196F3),
  Color(0xFFE91E63),
  Color(0xFF795548),
  Color(0xFF9E9E9E),
  Color(0xFFFF9800),
  Color(0xFF4CAF50),
  Color(0xFF607D8B),
  Color(0xFF00BCD4),
  Color(0xFFFF5722),
];

String _monthRangeStart(String month) {
  return '$month-01';
}

String _monthRangeEnd(String month) {
  final parts = month.split('-');
  final y = int.parse(parts[0]);
  final m = int.parse(parts[1]);
  final lastDay = DateTime(y, m + 1, 0).day;
  return '$month-${lastDay.toString().padLeft(2, '0')}';
}

class _HomeScreenState extends State<HomeScreen> {
  List<Map<String, dynamic>> _transactions = [];
  Map<String, dynamic>? _budgetStatus;
  Map<String, dynamic>? _budgetByCategory;
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _tags = [];
  bool _loading = true;
  String? _error;

  bool _useAllTime = false;
  bool _useDateRange = false;
  String _month = '';
  String _dateFrom = '';
  String _dateTo = '';

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = '${now.year}-${now.month.toString().padLeft(2, '0')}';
    _dateFrom = _monthRangeStart(_month);
    _dateTo = _monthRangeEnd(_month);
    _load();
  }

  (String from, String to, String month) get _range {
    if (_useAllTime) return ('2000-01-01', '2030-12-31', _month);
    if (_useDateRange) return (_dateFrom, _dateTo, _month);
    return (_monthRangeStart(_month), _monthRangeEnd(_month), _month);
  }

  Future<void> _load() async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    final (from, to, month) = _range;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final res = await api.get('/v1/transactions', {'from': from, 'to': to, 'limit': '20'});
      final budgetRes = await api.get('/v1/insights/budget-status', {'month': month});
      final byCatRes = await api.get('/v1/insights/budget-by-category', _useAllTime ? {'month': month, 'from': from, 'to': to} : {'month': month});
      final catRes = await api.get('/v1/categories');
      final tagRes = await api.get('/v1/tags');
      if (mounted) {
        setState(() {
          _transactions = List<Map<String, dynamic>>.from(res['transactions'] ?? []);
          _budgetStatus = budgetRes;
          _budgetByCategory = byCatRes;
          _categories = List<Map<String, dynamic>>.from(catRes['categories'] ?? []);
          _tags = List<Map<String, dynamic>>.from(tagRes['tags'] ?? []);
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
    final v = _budgetByCategory?['total_actual'];
    if (v != null) return (v as num).toDouble();
    return 0;
  }

  double get _totalBudget {
    final v = _budgetByCategory?['total_budget'];
    if (v != null) return (v as num).toDouble();
    final list = _budgetStatus?['budget_status'] as List?;
    if (list == null) return 0;
    double sum = 0;
    for (final b in list) {
      sum += (b['amount'] as num?)?.toDouble() ?? 0;
    }
    return sum;
  }

  List<Map<String, dynamic>> get _summaryItems {
    final items = _budgetByCategory?['items'] as List?;
    if (items == null) return [];
    return items.map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  String _budgetScopeDisplay(Map<String, dynamic> b) {
    final scopeName = b['scope_name'] as String?;
    if (scopeName != null && scopeName.isNotEmpty) return scopeName;
    if (b['scope_type'] == 'total_monthly') return 'Total';
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Mezan'),
        actions: [
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_vert),
            onSelected: (value) {
              switch (value) {
                case 'scan':
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const AddFromImageScreen())).then((_) => _load());
                  break;
                case 'sheet':
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const MergeFromSheetScreen())).then((_) => _load());
                  break;
                case 'setup':
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const SetupWizardHubScreen())).then((_) => _load());
                  break;
              }
            },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'scan', child: Text('Scan receipt')),
              const PopupMenuItem(value: 'sheet', child: Text('Merge from sheet')),
              const PopupMenuItem(value: 'setup', child: Text('Setup wizard')),
            ],
          ),
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
                    // Time range filter at top – compact
                    Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              children: [
                                _TimeRangeSegment(
                                  label: 'This month',
                                  selected: !_useAllTime && !_useDateRange,
                                  onTap: () => setState(() {
                                    _useAllTime = false;
                                    _useDateRange = false;
                                    _load();
                                  }),
                                ),
                                const SizedBox(width: 8),
                                _TimeRangeSegment(
                                  label: 'Custom',
                                  selected: !_useAllTime && _useDateRange,
                                  onTap: () => setState(() {
                                    _useAllTime = false;
                                    _useDateRange = true;
                                    if (_dateFrom.isEmpty) _dateFrom = _monthRangeStart(_month);
                                    if (_dateTo.isEmpty) _dateTo = _monthRangeEnd(_month);
                                    _load();
                                  }),
                                ),
                                const SizedBox(width: 8),
                                _TimeRangeSegment(
                                  label: 'All time',
                                  selected: _useAllTime,
                                  onTap: () => setState(() {
                                    _useAllTime = true;
                                    _useDateRange = false;
                                    _load();
                                  }),
                                ),
                              ],
                            ),
                            if (!_useAllTime && !_useDateRange) ...[
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Text('Month', style: Theme.of(context).textTheme.labelSmall),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: FilledButton.tonal(
                                      style: FilledButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(vertical: 8),
                                        minimumSize: Size.zero,
                                      ),
                                      onPressed: () async {
                                        final parts = _month.split('-');
                                        final initial = DateTime(int.parse(parts[0]), int.parse(parts[1]), 1);
                                        final picked = await showDatePicker(
                                          context: context,
                                          initialDate: initial,
                                          firstDate: DateTime(2020, 1),
                                          lastDate: DateTime(2030, 12),
                                          initialDatePickerMode: DatePickerMode.year,
                                        );
                                        if (picked != null && mounted) {
                                          setState(() {
                                            _month = '${picked.year}-${picked.month.toString().padLeft(2, '0')}';
                                            _load();
                                          });
                                        }
                                      },
                                      child: Text(_month, style: const TextStyle(fontSize: 13)),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                            if (!_useAllTime && _useDateRange) ...[
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  Expanded(
                                    child: FilledButton.tonal(
                                      style: FilledButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(vertical: 8),
                                        minimumSize: Size.zero,
                                      ),
                                      onPressed: () async {
                                        final picked = await showDatePicker(
                                          context: context,
                                          initialDate: _dateFrom.isNotEmpty ? DateTime.parse(_dateFrom) : DateTime.now(),
                                          firstDate: DateTime(2020),
                                          lastDate: DateTime(2030),
                                        );
                                        if (picked != null && mounted) {
                                          setState(() {
                                            _dateFrom = '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
                                            _load();
                                          });
                                        }
                                      },
                                      child: Text(_dateFrom.isEmpty ? 'From' : _dateFrom, style: const TextStyle(fontSize: 12)),
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Expanded(
                                    child: FilledButton.tonal(
                                      style: FilledButton.styleFrom(
                                        padding: const EdgeInsets.symmetric(vertical: 8),
                                        minimumSize: Size.zero,
                                      ),
                                      onPressed: () async {
                                        final picked = await showDatePicker(
                                          context: context,
                                          initialDate: _dateTo.isNotEmpty ? DateTime.parse(_dateTo) : DateTime.now(),
                                          firstDate: DateTime(2020),
                                          lastDate: DateTime(2030),
                                        );
                                        if (picked != null && mounted) {
                                          setState(() {
                                            _dateTo = '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
                                            _load();
                                          });
                                        }
                                      },
                                      child: Text(_dateTo.isEmpty ? 'To' : _dateTo, style: const TextStyle(fontSize: 12)),
                                    ),
                                  ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    Text(
                      _useAllTime ? 'Your spending (all time)' : 'Your spending this period',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                    ),
                    const SizedBox(height: 12),
                    _SummaryCard(
                      label: 'Spent',
                      value: 'EGP ${_monthTotal.toStringAsFixed(2)}',
                      valueColor: _monthTotal > _totalBudget && _totalBudget > 0
                          ? Theme.of(context).colorScheme.error
                          : Theme.of(context).colorScheme.primary,
                    ),
                    const SizedBox(height: 8),
                    _SummaryCard(
                      label: 'Remaining',
                      value: 'EGP ${(_totalBudget - _monthTotal).toStringAsFixed(2)}',
                      valueColor: _totalBudget - _monthTotal >= 0
                          ? Theme.of(context).colorScheme.tertiary
                          : Theme.of(context).colorScheme.error,
                    ),
                    if (_summaryItems.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text('Spending by category', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      SizedBox(
                        height: 220,
                        child: PieChart(
                          PieChartData(
                            sectionsSpace: 2,
                            centerSpaceRadius: 48,
                            sections: () {
                              final items = _summaryItems.where((e) => ((e['actual'] as num?)?.toDouble() ?? 0) > 0).toList();
                              final total = items.fold<double>(0, (s, e) => s + ((e['actual'] as num?)?.toDouble() ?? 0));
                              return items.asMap().entries.map((e) {
                                final v = (e.value['actual'] as num?)?.toDouble() ?? 0;
                                final pct = total > 0 ? (v / total * 100).round() : 0;
                                return PieChartSectionData(
                                  value: v,
                                  title: pct >= 2 ? '$pct%' : '',
                                  color: _chartColors[e.key % _chartColors.length],
                                  radius: 48,
                                  titleStyle: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500),
                                );
                              }).toList();
                            }(),
                          ),
                        ),
                      ),
                      const SizedBox(height: 20),
                      Text('Budget vs actual', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      LayoutBuilder(
                        builder: (context, constraints) {
                          const minBarGroupWidth = 56.0;
                          final count = _summaryItems.length;
                          final chartWidth = (count * minBarGroupWidth).clamp(constraints.maxWidth, double.infinity);
                          return SingleChildScrollView(
                            scrollDirection: Axis.horizontal,
                            child: SizedBox(
                              width: chartWidth,
                              height: 220,
                              child: BarChart(
                                BarChartData(
                                  alignment: BarChartAlignment.spaceAround,
                                  maxY: () {
                                    double maxVal = 0;
                                    for (final r in _summaryItems) {
                                      final budget = (r['budget'] as num?)?.toDouble() ?? 0.0;
                                      final actual = (r['actual'] as num?)?.toDouble() ?? 0.0;
                                      if (budget > maxVal) maxVal = budget;
                                      if (actual > maxVal) maxVal = actual;
                                    }
                                    return (maxVal * 1.1).clamp(1.0, double.infinity);
                                  }(),
                                  barGroups: _summaryItems.asMap().entries.map((e) {
                                    final budget = (e.value['budget'] as num?)?.toDouble() ?? 0;
                                    final actual = (e.value['actual'] as num?)?.toDouble() ?? 0;
                                    return BarChartGroupData(
                                      x: e.key,
                                      barRods: [
                                        BarChartRodData(toY: budget, color: Theme.of(context).colorScheme.primary, width: 10, borderRadius: const BorderRadius.vertical(top: Radius.circular(2))),
                                        BarChartRodData(toY: actual, color: Theme.of(context).colorScheme.tertiary, width: 10, borderRadius: const BorderRadius.vertical(top: Radius.circular(2))),
                                      ],
                                      showingTooltipIndicators: [],
                                    );
                                  }).toList(),
                                  titlesData: FlTitlesData(
                                    leftTitles: AxisTitles(sideTitles: SideTitles(showTitles: true, reservedSize: 36, getTitlesWidget: (v, _) => Text('${(v / 1000).toStringAsFixed(0)}k', style: const TextStyle(fontSize: 10)))),
                                    bottomTitles: AxisTitles(
                                      sideTitles: SideTitles(
                                        showTitles: true,
                                        getTitlesWidget: (v, _) {
                                          final i = v.toInt();
                                          if (i >= 0 && i < _summaryItems.length) {
                                            final name = _summaryItems[i]['category_name'] as String? ?? '';
                                            return Padding(
                                              padding: const EdgeInsets.only(top: 6),
                                              child: Text(name.length > 10 ? '${name.substring(0, 9)}…' : name, style: const TextStyle(fontSize: 10), maxLines: 1, overflow: TextOverflow.ellipsis, textAlign: TextAlign.center),
                                            );
                                          }
                                          return const SizedBox.shrink();
                                        },
                                        reservedSize: 32,
                                      ),
                                    ),
                                    topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                                    rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                                  ),
                                  gridData: const FlGridData(show: true, drawVerticalLine: false),
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                      const SizedBox(height: 20),
                      Text('Summary by category', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          ..._summaryItems.map((r) {
                            final budget = (r['budget'] as num?)?.toDouble() ?? 0;
                            final actual = (r['actual'] as num?)?.toDouble() ?? 0;
                            final diff = (r['difference'] as num?)?.toDouble() ?? (budget - actual);
                            final pct = budget > 0 ? (actual / budget).clamp(0.0, 1.0) : 0.0;
                            return _SummaryCategoryCard(
                              name: (r['category_name'] as String?) ?? '—',
                              budget: budget,
                              actual: actual,
                              diff: diff,
                              progress: pct,
                              isTotal: false,
                            );
                          }),
                          _SummaryCategoryCard(
                            name: 'Total',
                            budget: _totalBudget,
                            actual: _monthTotal,
                            diff: _totalBudget - _monthTotal,
                            progress: _totalBudget > 0 ? (_monthTotal / _totalBudget).clamp(0.0, 1.0) : 0,
                            isTotal: true,
                          ),
                        ],
                      ),
                    ],
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
                            title: Text(_budgetScopeDisplay(b)),
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
                        Text('Recent transactions', style: Theme.of(context).textTheme.titleMedium),
                        TextButton(
                          onPressed: () => Navigator.push(
                            context,
                            MaterialPageRoute(builder: (_) => const TransactionsScreen()),
                          ).then((_) => _load()),
                          child: const Text('View all'),
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
                        final currency = (t['currency'] as String?)?.trim().toUpperCase() ?? 'EGP';
                        final egpVal = t['egp_value'] as num?;
                        final cat = t['category'] as Map?;
                        final name = cat?['name'] ?? '—';
                        return ListTile(
                          leading: CircleAvatar(
                            child: Text(name.isNotEmpty ? name[0].toUpperCase() : '?'),
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
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 8),
          child: NavigationBar(
            selectedIndex: 0,
            labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
            destinations: const [
              NavigationDestination(icon: Icon(Icons.home_outlined), selectedIcon: Icon(Icons.home), label: 'Home'),
              NavigationDestination(icon: Icon(Icons.list_alt_outlined), selectedIcon: Icon(Icons.list_alt), label: 'Trans'),
              NavigationDestination(icon: Icon(Icons.pie_chart_outline), selectedIcon: Icon(Icons.pie_chart), label: 'Charts'),
              NavigationDestination(icon: Icon(Icons.account_balance_wallet_outlined), selectedIcon: Icon(Icons.account_balance_wallet), label: 'Budgets'),
              NavigationDestination(icon: Icon(Icons.category_outlined), selectedIcon: Icon(Icons.category), label: 'Cats'),
              NavigationDestination(icon: Icon(Icons.label_outlined), selectedIcon: Icon(Icons.label), label: 'Tags'),
            ],
            onDestinationSelected: (i) {
              if (i == 1) Navigator.push(context, MaterialPageRoute(builder: (_) => const TransactionsScreen()));
              if (i == 2) Navigator.push(context, MaterialPageRoute(builder: (_) => const ChartsScreen()));
              if (i == 3) Navigator.push(context, MaterialPageRoute(builder: (_) => const BudgetsScreen()));
              if (i == 4) Navigator.push(context, MaterialPageRoute(builder: (_) => const CategoriesScreen()));
              if (i == 5) Navigator.push(context, MaterialPageRoute(builder: (_) => const TagsScreen()));
            },
          ),
        ),
      ),
    );
  }
}

class _TimeRangeSegment extends StatelessWidget {
  const _TimeRangeSegment({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected
          ? Theme.of(context).colorScheme.primaryContainer
          : Theme.of(context).colorScheme.surfaceContainerHighest,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
              fontWeight: selected ? FontWeight.w600 : FontWeight.normal,
              color: selected ? Theme.of(context).colorScheme.onPrimaryContainer : Theme.of(context).colorScheme.onSurface,
            ),
          ),
        ),
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.label,
    required this.value,
    required this.valueColor,
  });

  final String label;
  final String value;
  final Color valueColor;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            const SizedBox(height: 4),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                value,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: valueColor,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SummaryCategoryCard extends StatelessWidget {
  const _SummaryCategoryCard({
    required this.name,
    required this.budget,
    required this.actual,
    required this.diff,
    required this.progress,
    required this.isTotal,
  });

  final String name;
  final double budget;
  final double actual;
  final double diff;
  final double progress;
  final bool isTotal;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final textStyle = isTotal
        ? theme.textTheme.titleSmall?.copyWith(
            fontWeight: FontWeight.w600,
            color: theme.colorScheme.primary,
          )
        : theme.textTheme.titleSmall;
    final diffColor = diff >= 0 ? theme.colorScheme.tertiary : theme.colorScheme.error;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(name, style: textStyle, maxLines: 1, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Budget', style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                Text('EGP ${budget.toStringAsFixed(0)}', style: theme.textTheme.bodySmall),
              ],
            ),
            const SizedBox(height: 2),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Actual', style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                Text('EGP ${actual.toStringAsFixed(0)}', style: theme.textTheme.bodySmall),
              ],
            ),
            const SizedBox(height: 2),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Diff', style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                Text('EGP ${diff.toStringAsFixed(0)}', style: theme.textTheme.bodySmall?.copyWith(color: diffColor, fontWeight: isTotal ? FontWeight.w600 : null)),
              ],
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(4),
              child: LinearProgressIndicator(
                value: progress > 1 ? 1.0 : progress,
                backgroundColor: theme.colorScheme.surfaceContainerHighest,
                color: progress > 1 ? theme.colorScheme.error : theme.colorScheme.primary,
                minHeight: 6,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
