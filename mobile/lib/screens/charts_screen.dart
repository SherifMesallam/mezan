import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:fl_chart/fl_chart.dart';
import '../api.dart';
import '../app_state.dart';

class ChartsScreen extends StatefulWidget {
  const ChartsScreen({super.key});

  @override
  State<ChartsScreen> createState() => _ChartsScreenState();
}

class _ChartsScreenState extends State<ChartsScreen> {
  List<Map<String, dynamic>> _summary = [];
  String _groupBy = 'category';
  String _from = '';
  String _to = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _to = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    _from = '${now.year}-${now.month.toString().padLeft(2, '0')}-01';
    _load();
  }

  Future<void> _load() async {
    final state = context.read<AppState>();
    final token = state.token;
    if (token == null) return;
    setState(() => _loading = true);
    try {
      final api = Api(baseUrl: state.effectiveBaseUrl, token: token);
      final res = await api.get('/v1/insights/summary', {
        'from': _from,
        'to': _to,
        'group_by': _groupBy,
      });
      if (mounted) {
        setState(() {
          _summary = List<Map<String, dynamic>>.from(res['summary'] ?? []);
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
        title: const Text('Charts'),
        actions: [
          PopupMenuButton<String>(
            initialValue: _groupBy,
            onSelected: (v) {
              setState(() => _groupBy = v);
              _load();
            },
            itemBuilder: (_) => [
              const PopupMenuItem(value: 'category', child: Text('By category')),
              const PopupMenuItem(value: 'tag', child: Text('By tag')),
              const PopupMenuItem(value: 'day', child: Text('By day')),
            ],
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _summary.isEmpty
              ? const Center(child: Text('No data for this period'))
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      SizedBox(
                        height: 200,
                        child: PieChart(
                          PieChartData(
                            sections: _summary.asMap().entries.map((e) {
                              final total = _summary.fold<double>(
                                  0, (s, x) => s + ((x['total'] as num?)?.toDouble() ?? 0));
                              final v = (e.value['total'] as num?)?.toDouble() ?? 0;
                              return PieChartSectionData(
                                value: v,
                                title: total > 0 ? '${(v / total * 100).toStringAsFixed(0)}%' : '',
                                color: Colors.primaries[e.key % Colors.primaries.length],
                              );
                            }).toList(),
                          ),
                        ),
                      ),
                      const SizedBox(height: 24),
                      ..._summary.map((s) => ListTile(
                            title: Text(s['key']?.toString() ?? ''),
                            trailing: Text('EGP ${(s['total'] as num?)?.toStringAsFixed(2) ?? '0'}'),
                          )),
                    ],
                  ),
                ),
    );
  }
}
