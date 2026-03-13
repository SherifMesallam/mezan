import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import 'add_transaction_screen.dart';
import 'add_from_sms_screen.dart';
import 'categories_screen.dart';
import 'tags_screen.dart';
import 'charts_screen.dart';
import 'add_from_image_screen.dart';
import 'add_from_voice_screen.dart';
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

/// High-contrast palette: distinct hues so categories are easy to tell apart.
const _chartColors = [
  Color(0xFF1565C0), // blue
  Color(0xFF2E7D32), // green
  Color(0xFFC62828), // red
  Color(0xFFF9A825), // amber
  Color(0xFF6A1B9A), // purple
  Color(0xFF00838F), // teal
  Color(0xFFD84315), // deep orange
  Color(0xFFAD1457), // pink
  Color(0xFF37474F), // blue grey
  Color(0xFF558B2F), // light green
  Color(0xFF00695C), // dark teal
  Color(0xFF7B1FA2), // violet
  Color(0xFFE65100), // orange
  Color(0xFF0277BD), // light blue
  Color(0xFF5D4037), // brown
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

const List<String> _monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

String _formatMonth(String month) {
  final parts = month.split('-');
  if (parts.length != 2) return month;
  final m = int.tryParse(parts[1]) ?? 0;
  final y = parts[0];
  if (m >= 1 && m <= 12) return '${_monthNames[m - 1]} $y';
  return month;
}

String _formatShortDate(String iso) {
  if (iso.length < 10) return iso;
  final d = DateTime.tryParse(iso);
  if (d == null) return iso;
  return '${d.day} ${_monthNames[d.month - 1].substring(0, 3)} ${d.year}';
}

class _HomeScreenState extends State<HomeScreen> {
  List<Map<String, dynamic>> _transactions = [];
  Map<String, dynamic>? _budgetStatus;
  Map<String, dynamic>? _budgetByCategory;
  Map<String, dynamic>? _insights;
  Map<String, dynamic>? _prediction;
  Map<String, dynamic>? _spendingExplanation;
  List<dynamic>? _anomalies;
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _tags = [];
  bool _loading = true;
  String? _error;

  bool _useAllTime = false;
  bool _useDateRange = false;
  String _month = '';
  String _dateFrom = '';
  String _dateTo = '';
  bool _timeFilterExpanded = false;
  bool _fabExpanded = false;

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
      Map<String, dynamic>? insightsRes;
      try {
        insightsRes = await api.get('/v1/insights/spending-patterns', {'from': from, 'to': to});
      } catch (_) {
        insightsRes = null;
      }
      Map<String, dynamic>? predictionRes;
      try {
        predictionRes = await api.get('/v1/insights/predict-end-of-month', {'month': month});
      } catch (_) {
        predictionRes = null;
      }
      Map<String, dynamic>? explanationRes;
      try {
        explanationRes = await api.get('/v1/insights/spending-explanation', {'from': from, 'to': to});
      } catch (_) {
        explanationRes = null;
      }
      List<dynamic>? anomaliesList;
      try {
        final anRes = await api.get('/v1/insights/anomalies', {'from': from, 'to': to});
        anomaliesList = anRes['anomalies'] as List<dynamic>?;
      } catch (_) {
        anomaliesList = null;
      }
      final catRes = await api.get('/v1/categories');
      final tagRes = await api.get('/v1/tags');
      if (mounted) {
        setState(() {
          _transactions = List<Map<String, dynamic>>.from(res['transactions'] ?? []);
          _budgetStatus = budgetRes;
          _budgetByCategory = byCatRes;
          _insights = insightsRes;
          _prediction = predictionRes;
          _spendingExplanation = explanationRes;
          _anomalies = anomaliesList;
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
                    // Time range: collapsed = title + "Tap to set time range"; expanded = full filter
                    _TimeFilterSection(
                      expanded: _timeFilterExpanded,
                      useAllTime: _useAllTime,
                      useDateRange: _useDateRange,
                      month: _month,
                      dateFrom: _dateFrom,
                      dateTo: _dateTo,
                      onToggle: () => setState(() => _timeFilterExpanded = !_timeFilterExpanded),
                      onSelectMonth: () async {
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
                            _timeFilterExpanded = false;
                            _load();
                          });
                        }
                      },
                      onSelectThisMonth: () => setState(() {
                        _useAllTime = false;
                        _useDateRange = false;
                        _timeFilterExpanded = false;
                        _load();
                      }),
                      onSelectCustom: () => setState(() {
                        _useAllTime = false;
                        _useDateRange = true;
                        if (_dateFrom.isEmpty) _dateFrom = _monthRangeStart(_month);
                        if (_dateTo.isEmpty) _dateTo = _monthRangeEnd(_month);
                        _load();
                      }),
                      onSelectFrom: () async {
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
                      onSelectTo: () async {
                        final picked = await showDatePicker(
                          context: context,
                          initialDate: _dateTo.isNotEmpty ? DateTime.parse(_dateTo) : DateTime.now(),
                          firstDate: DateTime(2020),
                          lastDate: DateTime(2030),
                        );
                        if (picked != null && mounted) {
                          setState(() {
                            _dateTo = '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
                            _timeFilterExpanded = false;
                            _load();
                          });
                        }
                      },
                      onSelectAllTime: () => setState(() {
                        _useAllTime = true;
                        _useDateRange = false;
                        _timeFilterExpanded = false;
                        _load();
                      }),
                    ),
                    const SizedBox(height: 16),
                    // Spent & Remaining – main focus, bigger and bolder
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: _SummaryCard(
                            label: 'Spent',
                            value: 'EGP ${_monthTotal.toStringAsFixed(0)}',
                            valueColor: const Color(0xFF2196F3),
                            prominent: true,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: _SummaryCard(
                            label: 'Remaining',
                            value: 'EGP ${(_totalBudget - _monthTotal).toStringAsFixed(0)}',
                            valueColor: _totalBudget > 0 && (_totalBudget - _monthTotal) < _totalBudget * 0.10
                                ? const Color(0xFFE57373)
                                : const Color(0xFF4CAF50),
                            prominent: true,
                          ),
                        ),
                      ],
                    ),
                    if (_summaryItems.isNotEmpty) ...[
                      const SizedBox(height: 16),
                      Text(
                        'Where your money is going',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 8),
                      _SpendingByCategoryWaffle(summaryItems: _summaryItems),
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
                    if (_summaryItems.isNotEmpty) ...[
                      const SizedBox(height: 20),
                      Text('Insights', style: Theme.of(context).textTheme.titleMedium),
                      const SizedBox(height: 8),
                      _InsightsSection(insights: _insights),
                      if (_spendingExplanation != null && (_spendingExplanation!['explanation'] as String?)?.isNotEmpty == true) ...[
                        const SizedBox(height: 20),
                        Text('Spending summary', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        _SpendingSummarySection(explanation: _spendingExplanation!),
                      ],
                      if (_anomalies != null && _anomalies!.isNotEmpty) ...[
                        const SizedBox(height: 20),
                        Text('Anomaly alerts', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        _AnomaliesSection(anomalies: _anomalies!),
                      ],
                      if (_prediction != null) ...[
                        const SizedBox(height: 20),
                        Text('Prediction', style: Theme.of(context).textTheme.titleMedium),
                        const SizedBox(height: 8),
                        _PredictionSection(prediction: _prediction!),
                      ],
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
      floatingActionButton: _HomeFab(
        expanded: _fabExpanded,
        onToggle: () => setState(() => _fabExpanded = !_fabExpanded),
        onAdd: () {
          setState(() => _fabExpanded = false);
          Navigator.push(context, MaterialPageRoute(builder: (_) => const AddTransactionScreen())).then((_) => _load());
        },
        onVoice: () {
          setState(() => _fabExpanded = false);
          Navigator.push(context, MaterialPageRoute(builder: (_) => const AddFromVoiceScreen())).then((_) => _load());
        },
        onSms: () {
          setState(() => _fabExpanded = false);
          Navigator.push(context, MaterialPageRoute(builder: (_) => const AddFromSmsScreen())).then((_) => _load());
        },
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

/// Collapsed: "Showing data for March 2026" + "Tap to set time range". Expanded: full filter.
class _TimeFilterSection extends StatelessWidget {
  const _TimeFilterSection({
    required this.expanded,
    required this.useAllTime,
    required this.useDateRange,
    required this.month,
    required this.dateFrom,
    required this.dateTo,
    required this.onToggle,
    required this.onSelectMonth,
    required this.onSelectThisMonth,
    required this.onSelectCustom,
    required this.onSelectFrom,
    required this.onSelectTo,
    required this.onSelectAllTime,
  });

  final bool expanded;
  final bool useAllTime;
  final bool useDateRange;
  final String month;
  final String dateFrom;
  final String dateTo;
  final VoidCallback onToggle;
  final VoidCallback onSelectMonth;
  final VoidCallback onSelectThisMonth;
  final VoidCallback onSelectCustom;
  final VoidCallback onSelectFrom;
  final VoidCallback onSelectTo;
  final VoidCallback onSelectAllTime;

  String _title() {
    if (useAllTime) return 'Showing data for all time';
    if (useDateRange) return '${_formatShortDate(dateFrom)} – ${_formatShortDate(dateTo)}';
    return 'Showing data for ${_formatMonth(month)}';
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (!expanded) {
      return Card(
        margin: const EdgeInsets.only(bottom: 8),
        child: InkWell(
          onTap: onToggle,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(
              children: [
                Icon(Icons.calendar_today_outlined, size: 20, color: theme.colorScheme.primary),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(_title(), style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600)),
                      const SizedBox(height: 2),
                      Text('Tap to set time range', style: theme.textTheme.bodySmall?.copyWith(color: theme.colorScheme.onSurfaceVariant)),
                    ],
                  ),
                ),
                Icon(Icons.keyboard_arrow_down, color: theme.colorScheme.onSurfaceVariant),
              ],
            ),
          ),
        ),
      );
    }
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('Set time range', style: theme.textTheme.titleSmall),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: onToggle,
                  style: IconButton.styleFrom(padding: const EdgeInsets.all(4), minimumSize: const Size(32, 32)),
                ),
              ],
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                _TimeRangeSegment(label: 'This month', selected: !useAllTime && !useDateRange, onTap: onSelectThisMonth),
                const SizedBox(width: 6),
                _TimeRangeSegment(label: 'Custom', selected: !useAllTime && useDateRange, onTap: onSelectCustom),
                const SizedBox(width: 6),
                _TimeRangeSegment(label: 'All time', selected: useAllTime, onTap: onSelectAllTime),
              ],
            ),
            if (!useAllTime && !useDateRange) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  Text('Month', style: theme.textTheme.labelSmall?.copyWith(fontSize: 11)),
                  const SizedBox(width: 6),
                  Expanded(
                    child: FilledButton.tonal(
                      style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 4), minimumSize: Size.zero),
                      onPressed: onSelectMonth,
                      child: Text(month, style: const TextStyle(fontSize: 12)),
                    ),
                  ),
                ],
              ),
            ],
            if (!useAllTime && useDateRange) ...[
              const SizedBox(height: 6),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.tonal(
                      style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 4), minimumSize: Size.zero),
                      onPressed: onSelectFrom,
                      child: Text(dateFrom.isEmpty ? 'From' : dateFrom, style: const TextStyle(fontSize: 11)),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: FilledButton.tonal(
                      style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 4), minimumSize: Size.zero),
                      onPressed: onSelectTo,
                      child: Text(dateTo.isEmpty ? 'To' : dateTo, style: const TextStyle(fontSize: 11)),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Insights: when you spend more (time of day, day of month), top vendor, top category.
class _InsightsSection extends StatelessWidget {
  const _InsightsSection({this.insights});

  final Map<String, dynamic>? insights;

  static String _hourLabel(int hour) {
    if (hour == 0) return 'midnight';
    if (hour == 12) return 'noon';
    if (hour < 12) return '${hour}am';
    return '${hour - 12}pm';
  }

  @override
  Widget build(BuildContext context) {
    if (insights == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    final peakTime = insights!['peak_time_of_day'] as Map<String, dynamic>?;
    final peakDay = insights!['peak_day_of_month'] as Map<String, dynamic>?;
    final peakDayOfWeek = insights!['peak_day_of_week'] as Map<String, dynamic>?;
    final topVendor = insights!['top_vendor'] as Map<String, dynamic>?;
    final topCategory = insights!['top_category'] as Map<String, dynamic>?;
    final spendingTrend = insights!['spending_trend'] as Map<String, dynamic>?;
    final largestTx = insights!['largest_transaction'] as Map<String, dynamic>?;
    final hasAny = peakTime != null || peakDay != null || peakDayOfWeek != null ||
        topVendor != null || topCategory != null || spendingTrend != null || largestTx != null;
    if (!hasAny) return const SizedBox.shrink();

    final cards = <Widget>[];
    void addCard(Widget row) {
      cards.add(
        Card(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: row,
          ),
        ),
      );
    }
    if (peakTime != null)
      addCard(_InsightRow(
        question: 'When do you usually spend more (time of day)?',
        answer: 'Around ${_hourLabel(peakTime['hour'] as int? ?? 12)} (EGP ${(peakTime['amount'] as num?)?.toStringAsFixed(0) ?? '0'} in that hour)',
        theme: theme,
      ));
    if (peakDay != null)
      addCard(_InsightRow(
        question: 'When do you usually spend more (day of month)?',
        answer: 'Around day ${peakDay['day']} (EGP ${(peakDay['amount'] as num?)?.toStringAsFixed(0) ?? '0'} on that day)',
        theme: theme,
      ));
    if (peakDayOfWeek != null)
      addCard(_InsightRow(
        question: 'Busiest day of week (by spend)?',
        answer: '${peakDayOfWeek['day_name'] ?? '—'} — EGP ${(peakDayOfWeek['amount'] as num?)?.toStringAsFixed(0) ?? '0'}',
        theme: theme,
      ));
    if (topVendor != null)
      addCard(_InsightRow(
        question: 'What vendor is taking most of your money?',
        answer: '${topVendor['name'] ?? '—'} — EGP ${(topVendor['amount'] as num?)?.toStringAsFixed(0) ?? '0'}',
        theme: theme,
      ));
    if (topCategory != null)
      addCard(_InsightRow(
        question: 'What category is taking most of your spending?',
        answer: '${topCategory['name'] ?? '—'} — EGP ${(topCategory['amount'] as num?)?.toStringAsFixed(0) ?? '0'}',
        theme: theme,
      ));
    if (spendingTrend != null)
      addCard(_InsightRow(
        question: 'Spending trend vs previous period?',
        answer: _trendAnswer(spendingTrend),
        theme: theme,
      ));
    if (largestTx != null)
      addCard(_InsightRow(
        question: 'Largest transaction?',
        answer: 'EGP ${(largestTx['amount'] as num?)?.toStringAsFixed(0) ?? '0'} — ${largestTx['merchant'] ?? '—'} (${largestTx['date'] ?? ''})',
        theme: theme,
      ));

    return Card(
      color: theme.colorScheme.surface,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (int i = 0; i < cards.length; i++) ...[
              if (i > 0) const SizedBox(height: 8),
              cards[i],
            ],
          ],
        ),
      ),
    );
  }

  static String _trendAnswer(Map<String, dynamic> t) {
    final trend = t['trend'] as String?;
    final pct = (t['percent_change'] as num?)?.toDouble();
    if (pct == null) return '—';
    final dir = trend == 'up' ? 'Up' : (trend == 'down' ? 'Down' : 'Same');
    final sign = pct >= 0 ? '+' : '';
    return '$dir $sign${pct.toStringAsFixed(1)}% vs previous period';
  }
}

class _InsightRow extends StatelessWidget {
  const _InsightRow({required this.question, required this.answer, required this.theme});

  final String question;
  final String answer;
  final ThemeData theme;

  /// Builds rich text with numbers and EGP amounts emphasized (bold + primary color).
  static InlineSpan _buildAnswerSpans(String text, ThemeData theme) {
    final baseStyle = theme.textTheme.bodyMedium?.copyWith(
      fontWeight: FontWeight.w600,
      color: theme.colorScheme.onSurface,
    ) ?? TextStyle(fontWeight: FontWeight.w600, color: theme.colorScheme.onSurface);
    final numberStyle = theme.textTheme.bodyMedium?.copyWith(
      fontWeight: FontWeight.bold,
      color: theme.colorScheme.primary,
    ) ?? TextStyle(fontWeight: FontWeight.bold, color: theme.colorScheme.primary);

    // Match EGP 1234, +12.3%, -5.2%, or standalone integers/floats that look like amounts
    final re = RegExp(r'(EGP\s*[\d,]+(?:\.\d+)?|[-+]?\d+(?:,\d{3})*(?:\.\d+)?%?)');
    final spans = <InlineSpan>[];
    int lastEnd = 0;
    for (final m in re.allMatches(text)) {
      if (m.start > lastEnd) {
        spans.add(TextSpan(text: text.substring(lastEnd, m.start), style: baseStyle));
      }
      spans.add(TextSpan(text: m.group(0), style: numberStyle));
      lastEnd = m.end;
    }
    if (lastEnd < text.length) {
      spans.add(TextSpan(text: text.substring(lastEnd), style: baseStyle));
    }
    if (spans.isEmpty) {
      spans.add(TextSpan(text: text, style: baseStyle));
    }
    return TextSpan(children: spans);
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          question,
          style: theme.textTheme.labelMedium?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
            fontWeight: FontWeight.w500,
          ),
        ),
        const SizedBox(height: 6),
        Text.rich(
          _buildAnswerSpans(answer, theme),
          textAlign: TextAlign.start,
        ),
      ],
    );
  }
}

/// Spending summary: one card with natural-language explanation from API.
class _SpendingSummarySection extends StatelessWidget {
  const _SpendingSummarySection({required this.explanation});

  final Map<String, dynamic> explanation;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final text = explanation['explanation'] as String? ?? '';
    if (text.isEmpty) return const SizedBox.shrink();
    return Card(
      color: theme.colorScheme.surface,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              text,
              style: theme.textTheme.bodyMedium?.copyWith(
                height: 1.4,
                color: theme.colorScheme.onSurface,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Anomaly alerts: one card per anomaly inside a section container.
class _AnomaliesSection extends StatelessWidget {
  const _AnomaliesSection({required this.anomalies});

  final List<dynamic> anomalies;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cards = <Widget>[];
    for (int i = 0; i < anomalies.length; i++) {
      final a = anomalies[i];
      if (a is! Map<String, dynamic>) continue;
      final message = a['message'] as String? ?? 'Unusual activity';
      cards.add(
        Card(
          color: theme.colorScheme.errorContainer.withOpacity(0.35),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.warning_amber_rounded, size: 20, color: theme.colorScheme.error),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    message,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurface,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
    return Card(
      color: theme.colorScheme.surface,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (int i = 0; i < cards.length; i++) ...[
              if (i > 0) const SizedBox(height: 8),
              cards[i],
            ],
          ],
        ),
      ),
    );
  }
}

/// Prediction: intro card + one card per type (Optimistic, More likely, Worst case).
class _PredictionSection extends StatelessWidget {
  const _PredictionSection({required this.prediction});

  final Map<String, dynamic> prediction;

  static const _cardPadding = EdgeInsets.symmetric(horizontal: 14, vertical: 12);
  static const _cardSpacing = 8.0;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final spent = (prediction['spent_so_far'] as num?)?.toDouble();
    final daysRemaining = prediction['days_remaining'] as int?;
    final optimisticTotal = (prediction['optimistic_predicted_total'] as num?)?.toDouble();
    final moreLikelyTotal = (prediction['more_likely_predicted_total'] as num?)?.toDouble();
    final worstCaseTotal = (prediction['worst_case_predicted_total'] as num?)?.toDouble();
    final optimisticText = prediction['optimistic_text'] as String? ?? '';
    final moreLikelyText = prediction['more_likely_text'] as String? ?? '';
    final worstCaseText = prediction['worst_case_text'] as String? ?? '';

    final labelStyle = theme.textTheme.labelMedium?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
      fontWeight: FontWeight.w500,
    );
    final bodyStyle = theme.textTheme.bodyMedium?.copyWith(
      color: theme.colorScheme.onSurface,
      height: 1.35,
    );
    final amountStyle = theme.textTheme.titleSmall?.copyWith(
      fontWeight: FontWeight.bold,
      color: theme.colorScheme.primary,
    );
    final subtitleStyle = theme.textTheme.bodySmall?.copyWith(
      color: theme.colorScheme.onSurfaceVariant,
    );

    const lightGreen = Color(0xFFE8F5E9);
    const lightBlue = Color(0xFFE3F2FD);
    const lightRed = Color(0xFFFFEBEE);

    final children = <Widget>[];

    // Intro text (no card, inside section)
    children.add(
      Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Given current spending, how much total spend is predicted by end of month?',
              style: labelStyle,
              maxLines: 3,
              overflow: TextOverflow.visible,
            ),
            if (spent != null || daysRemaining != null) ...[
              const SizedBox(height: 8),
              Text.rich(
                TextSpan(
                  style: subtitleStyle,
                  children: [
                    if (spent != null)
                      TextSpan(text: 'Spent so far: ', style: subtitleStyle),
                    if (spent != null)
                      TextSpan(
                        text: 'EGP ${spent.toStringAsFixed(0)}',
                        style: subtitleStyle?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: theme.colorScheme.primary,
                        ),
                      ),
                    if (spent != null && daysRemaining != null)
                      const TextSpan(text: '  ·  '),
                    if (daysRemaining != null)
                      TextSpan(text: '$daysRemaining days left in month'),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );

    // Optimistic card – light green
    if (optimisticTotal != null) {
      children.add(SizedBox(height: _cardSpacing));
      children.add(
        Card(
          color: lightGreen,
          child: Padding(
            padding: _cardPadding,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Optimistic prediction', style: labelStyle),
                const SizedBox(height: 6),
                Text(
                  'EGP ${optimisticTotal.toStringAsFixed(0)}',
                  style: amountStyle?.copyWith(fontSize: (amountStyle?.fontSize ?? 14) + 2),
                ),
                if (optimisticText.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(optimisticText, style: bodyStyle, maxLines: 4, overflow: TextOverflow.ellipsis),
                ],
              ],
            ),
          ),
        ),
      );
    }

    // More likely card – light blue
    if (moreLikelyTotal != null) {
      children.add(SizedBox(height: _cardSpacing));
      children.add(
        Card(
          color: lightBlue,
          child: Padding(
            padding: _cardPadding,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('More likely', style: labelStyle),
                const SizedBox(height: 6),
                Text(
                  'EGP ${moreLikelyTotal.toStringAsFixed(0)}',
                  style: amountStyle?.copyWith(
                    fontSize: (amountStyle?.fontSize ?? 14) + 2,
                    color: theme.colorScheme.tertiary,
                  ),
                ),
                if (moreLikelyText.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(moreLikelyText, style: bodyStyle, maxLines: 4, overflow: TextOverflow.ellipsis),
                ],
              ],
            ),
          ),
        ),
      );
    }

    // Worst case card – light red
    if (worstCaseTotal != null) {
      children.add(SizedBox(height: _cardSpacing));
      children.add(
        Card(
          color: lightRed,
          child: Padding(
            padding: _cardPadding,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text('Worst case', style: labelStyle),
                const SizedBox(height: 6),
                Text(
                  'EGP ${worstCaseTotal.toStringAsFixed(0)}',
                  style: amountStyle?.copyWith(
                    fontSize: (amountStyle?.fontSize ?? 14) + 2,
                    color: theme.colorScheme.error,
                  ),
                ),
                if (worstCaseText.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Text(worstCaseText, style: bodyStyle, maxLines: 2, overflow: TextOverflow.ellipsis),
                ],
              ],
            ),
          ),
        ),
      );
    }

    return Card(
      color: theme.colorScheme.surface,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: children,
        ),
      ),
    );
  }
}

/// Sorted horizontal bar chart: one row per category. Track = same (total budget); each category has its own color.
/// Each category's segment starts exactly where the previous one ends (stacked within the same bar).
class _SpendingByCategoryWaffle extends StatelessWidget {
  const _SpendingByCategoryWaffle({required this.summaryItems});

  final List<Map<String, dynamic>> summaryItems;

  @override
  Widget build(BuildContext context) {
    final items = summaryItems.where((e) => ((e['actual'] as num?)?.toDouble() ?? 0) > 0).toList();
    final total = items.fold<double>(0, (s, e) => s + ((e['actual'] as num?)?.toDouble() ?? 0));
    if (items.isEmpty) return const SizedBox.shrink();
    items.sort((a, b) => ((b['actual'] as num?)?.toDouble() ?? 0).compareTo((a['actual'] as num?)?.toDouble() ?? 0));
    final pcts = items.map((e) => total > 0 ? ((e['actual'] as num?)?.toDouble() ?? 0) / total : 0.0).toList();
    var cumul = 0.0;
    final starts = pcts.map((p) {
      final s = cumul;
      cumul += p;
      return s;
    }).toList();
    final theme = Theme.of(context);
    const rowHeight = 28.0;
    const labelWidth = 110.0;
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Percentage of total spend (%)',
              style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.onSurfaceVariant),
            ),
            const SizedBox(height: 8),
            for (var i = 0; i < items.length; i++) ...[
              if (i > 0) const SizedBox(height: 6),
              SizedBox(
                height: rowHeight,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    SizedBox(
                      width: labelWidth,
                      child: Text(
                        items[i]['category_name'] as String? ?? '—',
                        style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w500),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: LayoutBuilder(
                        builder: (_, constraints) {
                          final barAreaWidth = constraints.maxWidth;
                          final startOffset = (starts[i] * barAreaWidth).clamp(0.0, barAreaWidth);
                          final segWidth = (pcts[i] * barAreaWidth).clamp(0.0, barAreaWidth - startOffset);
                          return Stack(
                            alignment: Alignment.centerLeft,
                            children: [
                              Container(
                                height: 14,
                                decoration: BoxDecoration(
                                  color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                              ),
                              Positioned(
                                left: startOffset,
                                width: segWidth,
                                child: Container(
                                  height: 14,
                                  decoration: BoxDecoration(
                                    color: _chartColors[i % _chartColors.length],
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                ),
                              ),
                            ],
                          );
                        },
                      ),
                    ),
                    const SizedBox(width: 8),
                    SizedBox(
                      width: 36,
                      child: Text(
                        '${(pcts[i] * 100).toStringAsFixed(0)}%',
                        style: theme.textTheme.bodySmall?.copyWith(fontWeight: FontWeight.w600),
                        textAlign: TextAlign.end,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Speed-dial FAB: single + button; when expanded, shows Add / Voice / SMS above.
class _HomeFab extends StatelessWidget {
  const _HomeFab({
    required this.expanded,
    required this.onToggle,
    required this.onAdd,
    required this.onVoice,
    required this.onSms,
  });

  final bool expanded;
  final VoidCallback onToggle;
  final VoidCallback onAdd;
  final VoidCallback onVoice;
  final VoidCallback onSms;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        if (expanded) ...[
          _FabOption(icon: Icons.add, label: 'Add transaction', onTap: onAdd),
          const SizedBox(height: 8),
          _FabOption(icon: Icons.mic, label: 'Voice', onTap: onVoice),
          const SizedBox(height: 8),
          _FabOption(icon: Icons.sms, label: 'Message', onTap: onSms),
          const SizedBox(height: 12),
        ],
        AnimatedRotation(
          turns: expanded ? 0.125 : 0,
          duration: const Duration(milliseconds: 200),
          child: FloatingActionButton(
            heroTag: 'home_fab',
            onPressed: onToggle,
            child: Icon(expanded ? Icons.close : Icons.add),
          ),
        ),
      ],
    );
  }
}

class _FabOption extends StatelessWidget {
  const _FabOption({required this.icon, required this.label, required this.onTap});

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(right: 12),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Material(
            elevation: 2,
            borderRadius: BorderRadius.circular(20),
            color: theme.colorScheme.surfaceContainerHigh,
            child: InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(20),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                child: Text(label, style: theme.textTheme.labelLarge),
              ),
            ),
          ),
          const SizedBox(width: 8),
          FloatingActionButton.small(
            heroTag: label,
            onPressed: onTap,
            child: Icon(icon),
          ),
        ],
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
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
              fontSize: 12,
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
    this.prominent = false,
  });

  final String label;
  final String value;
  final Color valueColor;
  final bool prominent;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: prominent ? 16 : 12, horizontal: 10),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              label,
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontSize: prominent ? 12 : null,
              ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            SizedBox(height: prominent ? 6 : 4),
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: Alignment.centerLeft,
              child: Text(
                value,
                style: (prominent ? theme.textTheme.headlineSmall : theme.textTheme.titleMedium)?.copyWith(
                  fontWeight: FontWeight.bold,
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
    final isOverOrZero = diff <= 0;
    final progressBarColor = isOverOrZero ? theme.colorScheme.error : theme.colorScheme.primary;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      color: isOverOrZero ? theme.colorScheme.errorContainer.withValues(alpha: 0.35) : null,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                Expanded(child: Text(name, style: textStyle, maxLines: 1, overflow: TextOverflow.ellipsis)),
                if (isOverOrZero)
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.warning_amber_rounded, size: 16, color: theme.colorScheme.error),
                      const SizedBox(width: 4),
                      Text('Over budget', style: theme.textTheme.labelSmall?.copyWith(color: theme.colorScheme.error, fontWeight: FontWeight.w600)),
                    ],
                  ),
              ],
            ),
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
                color: progressBarColor,
                minHeight: 6,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
