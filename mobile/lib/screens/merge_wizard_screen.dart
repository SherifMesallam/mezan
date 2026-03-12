import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';

/// One row from sms-merge-preview or image-merge-preview.
class MergePreviewItem {
  MergePreviewItem.fromJson(Map<String, dynamic> json)
      : sheetIndex = (json['sheet_index'] as num?)?.toInt() ?? 0,
        amount = (json['amount'] as num?)?.toDouble() ?? 0,
        currency = json['currency'] as String? ?? 'EGP',
        date = json['date'] as String? ?? '',
        time = json['time'] as String?,
        categoryName = json['category_name'] as String? ?? 'Other',
        merchant = json['merchant'] as String?,
        sourceSnippet = json['source_snippet'] as String?,
        matchedEntryId = json['matched_entry_id'] as String?,
        matchedEntry = json['matched_entry'] != null
            ? MatchedEntry.fromJson(Map<String, dynamic>.from(json['matched_entry'] as Map))
            : null;

  final int sheetIndex;
  final double amount;
  final String currency;
  final String date;
  final String? time;
  final String categoryName;
  final String? merchant;
  final String? sourceSnippet;
  final String? matchedEntryId;
  final MatchedEntry? matchedEntry;
}

class MatchedEntry {
  MatchedEntry.fromJson(Map<String, dynamic> json)
      : id = json['id'] as String? ?? '',
        amount = (json['amount'] as num?)?.toDouble() ?? 0,
        date = json['date'] as String? ?? '',
        categoryName = json['category_name'] as String? ?? '',
        merchant = json['merchant'] as String?;

  final String id;
  final double amount;
  final String date;
  final String categoryName;
  final String? merchant;
}

typedef MergeWizardResult = ({int created, int skipped, int discarded});

class MergeWizardScreen extends StatefulWidget {
  const MergeWizardScreen({
    super.key,
    required this.items,
    required this.onReset,
    required this.onResult,
    this.resetButtonLabel = 'Paste again',
    this.sourceColumnLabel = 'From SMS',
  });

  final List<MergePreviewItem> items;
  final VoidCallback onReset;
  final void Function(MergeWizardResult) onResult;
  final String resetButtonLabel;
  final String sourceColumnLabel;

  @override
  State<MergeWizardScreen> createState() => _MergeWizardScreenState();
}

enum RowAction { skip, addNew, discard }

class _MergeWizardScreenState extends State<MergeWizardScreen> {
  final Map<int, RowAction> _actionByIndex = {};
  final Map<int, String> _amountByIndex = {};
  final Map<int, String> _currencyByIndex = {};
  final Map<int, String> _dateByIndex = {};
  final Map<int, String> _timeByIndex = {};
  final Map<int, String> _merchantByIndex = {};
  final Map<int, String> _categoryIdByIndex = {};
  final Map<int, List<String>> _tagIdsByIndex = {};
  final Map<int, MatchedEntry> _manualMatchByIndex = {};
  List<Map<String, dynamic>> _categories = [];
  List<Map<String, dynamic>> _tags = [];
  int? _pickerForSheetIndex;
  List<Map<String, dynamic>> _pickerTransactions = [];
  bool _pickerLoading = false;
  MatchedEntry? _viewEntry;
  bool _viewDialogShown = false;
  bool _confirming = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final it in widget.items) {
      _actionByIndex[it.sheetIndex] =
          (it.matchedEntryId != null) ? RowAction.skip : RowAction.addNew;
    }
    _loadCategoriesAndTags();
  }

  Api get _api {
    final state = context.read<AppState>();
    return Api(baseUrl: state.effectiveBaseUrl, token: state.token);
  }

  Future<void> _loadCategoriesAndTags() async {
    try {
      final catRes = await _api.get('/v1/categories');
      final tagRes = await _api.get('/v1/tags');
      if (mounted) {
        setState(() {
          _categories = List<Map<String, dynamic>>.from(catRes['categories'] ?? []);
          _tags = List<Map<String, dynamic>>.from(tagRes['tags'] ?? []);
        });
      }
    } catch (_) {}
  }

  double _getAmount(MergePreviewItem it) {
    final raw = _amountByIndex[it.sheetIndex];
    if (raw == null || raw.isEmpty) return it.amount;
    final n = double.tryParse(raw.replaceAll(',', '.'));
    return n != null ? n : it.amount;
  }

  String _getCurrency(MergePreviewItem it) {
    final c = _currencyByIndex[it.sheetIndex];
    return (c != null && c.isNotEmpty) ? c.trim() : it.currency;
  }

  String _getDate(MergePreviewItem it) =>
      (_dateByIndex[it.sheetIndex]?.trim().isNotEmpty == true)
          ? _dateByIndex[it.sheetIndex]!.trim()
          : it.date;

  String _getTime(MergePreviewItem it) {
    final t = _timeByIndex[it.sheetIndex];
    if (t != null && t.trim().isNotEmpty) return t.trim();
    return it.time ?? '';
  }

  String? _getMerchant(MergePreviewItem it) {
    final m = _merchantByIndex[it.sheetIndex];
    if (m == null) return it.merchant;
    final s = m.trim();
    return s.isEmpty ? null : s;
  }

  String _getCategoryName(MergePreviewItem it) {
    final id = _categoryIdByIndex[it.sheetIndex];
    if (id != null) {
      final c = _categories.cast<Map<String, dynamic>?>().firstWhere(
            (c) => c?['id'] == id,
            orElse: () => null,
          );
      if (c != null) return c['name'] as String? ?? it.categoryName;
    }
    return it.categoryName;
  }

  String? _getCategoryId(MergePreviewItem it) {
    final id = _categoryIdByIndex[it.sheetIndex];
    if (id != null && id.isNotEmpty) return id;
    final name = it.categoryName.trim().toLowerCase();
    for (final c in _categories) {
      if ((c['name'] as String? ?? '').trim().toLowerCase() == name) {
        return c['id'] as String?;
      }
    }
    return _categories.isNotEmpty ? _categories.first['id'] as String? : null;
  }

  MatchedEntry? _getDisplayMatch(MergePreviewItem it) {
    final manual = _manualMatchByIndex[it.sheetIndex];
    if (manual != null) return manual;
    return it.matchedEntry;
  }

  RowAction _getAction(MergePreviewItem it) =>
      _actionByIndex[it.sheetIndex] ??
      (it.matchedEntryId != null ? RowAction.skip : RowAction.addNew);

  Future<void> _loadPickerTransactions() async {
    if (_pickerForSheetIndex == null) return;
    setState(() => _pickerLoading = true);
    try {
      final now = DateTime.now();
      final to = '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
      final from = DateTime(now.year - 2, now.month, 1);
      final fromStr =
          '${from.year}-${from.month.toString().padLeft(2, '0')}-01';
      final res = await _api.get(
        '/v1/transactions',
        {'from': fromStr, 'to': to, 'limit': '300'},
      );
      if (mounted) {
        setState(() {
          _pickerTransactions =
              List<Map<String, dynamic>>.from(res['transactions'] ?? []);
          _pickerLoading = false;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _pickerLoading = false);
    }
  }

  Future<void> _openMatchPicker(int sheetIndex) async {
    setState(() {
      _pickerForSheetIndex = sheetIndex;
      _pickerTransactions = [];
      _error = null;
    });
    await _loadPickerTransactions();
    if (!mounted) return;
    final transactions = List<Map<String, dynamic>>.from(_pickerTransactions);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        initialChildSize: 0.6,
        minChildSize: 0.3,
        maxChildSize: 0.95,
        expand: false,
        builder: (_, scrollController) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                'Match to a transaction',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            Expanded(
              child: _pickerLoading
                  ? const Center(child: CircularProgressIndicator())
                  : transactions.isEmpty
                      ? const Center(child: Text('No transactions found'))
                      : ListView.builder(
                          controller: scrollController,
                          itemCount: transactions.length,
                          itemBuilder: (_, i) {
                            final tx = transactions[i];
                            final amount = (tx['amount'] as num?)?.toDouble() ?? 0.0;
                            final date = tx['date'] as String? ?? '';
                            final cat = tx['category_name'] as String? ?? '';
                            final merchant = tx['merchant'] as String?;
                            return ListTile(
                              title: Text(
                                '${amount.toStringAsFixed(2)} · $date',
                              ),
                              subtitle: Text(
                                '$cat${merchant != null ? ' · $merchant' : ''}',
                              ),
                              onTap: () {
                                _selectManualMatch(tx);
                                Navigator.pop(ctx);
                              },
                            );
                          },
                        ),
            ),
          ],
        ),
      ),
    );
    if (mounted) setState(() => _pickerForSheetIndex = null);
  }

  void _selectManualMatch(Map<String, dynamic> tx) {
    final sheetIndex = _pickerForSheetIndex;
    if (sheetIndex == null) return;
    final entry = MatchedEntry.fromJson(tx);
    setState(() {
      _manualMatchByIndex[sheetIndex] = entry;
      _actionByIndex[sheetIndex] = RowAction.skip;
      _pickerForSheetIndex = null;
    });
  }

  Future<void> _confirm() async {
    setState(() {
      _error = null;
      _confirming = true;
    });
    try {
      final payload = widget.items.map<Map<String, dynamic>>((it) {
        final action = _getAction(it);
        final base = {
          'sheet_index': it.sheetIndex,
          'action': action == RowAction.discard
              ? 'discard'
              : action == RowAction.addNew
                  ? 'add_new'
                  : 'skip',
        };
        final tagIds = _tagIdsByIndex[it.sheetIndex];
        if (action == RowAction.discard) return base;
        if (action == RowAction.addNew) {
          final categoryId = _getCategoryId(it);
          return {
            ...base,
            'amount': _getAmount(it),
            'currency': _getCurrency(it),
            'date': _getDate(it),
            'time': _getTime(it),
            'merchant': _getMerchant(it),
            'category_name': _getCategoryName(it),
            if (categoryId != null) 'category_id': categoryId,
            if (tagIds != null && tagIds.isNotEmpty) 'tag_ids': tagIds,
          };
        }
        final match = _getDisplayMatch(it);
        return {
          ...base,
          if (match != null) 'matched_entry_id': match.id,
          if (tagIds != null && tagIds.isNotEmpty) 'tag_ids': tagIds,
        };
      }).toList();

      final res = await _api.post('/v1/import/sms-merge-confirm', {'items': payload});
      final created = (res['count'] as num?)?.toInt() ?? 0;
      final skipped = (res['skipped'] as num?)?.toInt() ?? 0;
      final discarded = (res['discarded'] as num?)?.toInt() ?? 0;
      if (mounted) {
        widget.onResult((created: created, skipped: skipped, discarded: discarded));
        Navigator.of(context).pop();
      }
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _confirming = false);
    }
  }

  int get _addNewCount => widget.items
      .where((it) => _getAction(it) == RowAction.addNew)
      .length;

  void _maybeShowViewEntryDialog() {
    if (_viewEntry == null || _viewDialogShown) return;
    _viewDialogShown = true;
    final entry = _viewEntry!;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Matched entry'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Amount: ${entry.amount.toStringAsFixed(2)}'),
              const SizedBox(height: 4),
              Text('Date: ${entry.date}'),
              const SizedBox(height: 4),
              Text('Category: ${entry.categoryName}'),
              if (entry.merchant != null && entry.merchant!.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text('Merchant: ${entry.merchant}'),
              ],
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Close'),
            ),
          ],
        ),
      );
      if (mounted) setState(() {
        _viewEntry = null;
        _viewDialogShown = false;
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    _maybeShowViewEntryDialog();
    return Scaffold(
      appBar: AppBar(
        title: Text('${widget.items.length} transaction(s)'),
        actions: [
          TextButton(
            onPressed: () {
              widget.onReset();
              Navigator.of(context).pop();
            },
            child: Text(widget.resetButtonLabel),
          ),
        ],
      ),
      body: Column(
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              itemCount: widget.items.length,
              itemBuilder: (context, i) {
                final it = widget.items[i];
                return _MergeRowCard(
                  item: it,
                  sourceColumnLabel: widget.sourceColumnLabel,
                  categories: _categories,
                  tags: _tags,
                  action: _getAction(it),
                  displayMatch: _getDisplayMatch(it),
                  amountText: _amountByIndex[it.sheetIndex],
                  currencyText: _currencyByIndex[it.sheetIndex],
                  dateText: _dateByIndex[it.sheetIndex],
                  timeText: _timeByIndex[it.sheetIndex],
                  merchantText: _merchantByIndex[it.sheetIndex] ?? it.merchant,
                  categoryId: _categoryIdByIndex[it.sheetIndex] ??
                      _categories
                          .cast<Map<String, dynamic>?>()
                          .firstWhere(
                            (c) =>
                                (c?['name'] as String?)
                                    ?.trim()
                                    .toLowerCase() ==
                                it.categoryName.trim().toLowerCase(),
                            orElse: () => null,
                          )
                          ?['id'] ??
                      (_categories.isNotEmpty ? _categories.first['id'] : null),
                  tagIds: _tagIdsByIndex[it.sheetIndex] ?? [],
                  hasManualMatch: _manualMatchByIndex.containsKey(it.sheetIndex),
                  onAmountChanged: (v) =>
                      setState(() => _amountByIndex[it.sheetIndex] = v),
                  onCurrencyChanged: (v) =>
                      setState(() => _currencyByIndex[it.sheetIndex] = v),
                  onDateChanged: (v) =>
                      setState(() => _dateByIndex[it.sheetIndex] = v),
                  onTimeChanged: (v) =>
                      setState(() => _timeByIndex[it.sheetIndex] = v),
                  onMerchantChanged: (v) =>
                      setState(() => _merchantByIndex[it.sheetIndex] = v),
                  onCategoryChanged: (v) =>
                      setState(() => _categoryIdByIndex[it.sheetIndex] = v),
                  onTagToggled: (tagId) {
                    setState(() {
                      final cur = _tagIdsByIndex[it.sheetIndex] ?? [];
                      if (cur.contains(tagId)) {
                        _tagIdsByIndex[it.sheetIndex] =
                            cur.where((x) => x != tagId).toList();
                      } else {
                        _tagIdsByIndex[it.sheetIndex] = [...cur, tagId];
                      }
                    });
                  },
                  onActionChanged: (a) =>
                      setState(() => _actionByIndex[it.sheetIndex] = a),
                  onMatchToTransaction: () => _openMatchPicker(it.sheetIndex),
                  onViewMatch: (entry) => setState(() => _viewEntry = entry),
                );
              },
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: _confirming ? null : _confirm,
                  child: _confirming
                      ? const SizedBox(
                          height: 24,
                          width: 24,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(
                          _addNewCount > 0
                              ? 'Confirm and add $_addNewCount as new'
                              : 'Confirm (all matched)',
                        ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    super.dispose();
  }
}

class _MergeRowCard extends StatefulWidget {
  const _MergeRowCard({
    required this.item,
    required this.sourceColumnLabel,
    required this.categories,
    required this.tags,
    required this.action,
    required this.displayMatch,
    required this.amountText,
    required this.currencyText,
    required this.dateText,
    required this.timeText,
    required this.merchantText,
    required this.categoryId,
    required this.tagIds,
    required this.hasManualMatch,
    required this.onAmountChanged,
    required this.onCurrencyChanged,
    required this.onDateChanged,
    required this.onTimeChanged,
    required this.onMerchantChanged,
    required this.onCategoryChanged,
    required this.onTagToggled,
    required this.onActionChanged,
    required this.onMatchToTransaction,
    required this.onViewMatch,
  });

  final MergePreviewItem item;
  final String sourceColumnLabel;
  final List<Map<String, dynamic>> categories;
  final List<Map<String, dynamic>> tags;
  final RowAction action;
  final MatchedEntry? displayMatch;
  final String? amountText;
  final String? currencyText;
  final String? dateText;
  final String? timeText;
  final String? merchantText;
  final String? categoryId;
  final List<String> tagIds;
  final bool hasManualMatch;
  final ValueChanged<String> onAmountChanged;
  final ValueChanged<String> onCurrencyChanged;
  final ValueChanged<String> onDateChanged;
  final ValueChanged<String> onTimeChanged;
  final ValueChanged<String> onMerchantChanged;
  final ValueChanged<String?> onCategoryChanged;
  final ValueChanged<String> onTagToggled;
  final ValueChanged<RowAction> onActionChanged;
  final VoidCallback onMatchToTransaction;
  final ValueChanged<MatchedEntry> onViewMatch;

  @override
  State<_MergeRowCard> createState() => _MergeRowCardState();
}

class _MergeRowCardState extends State<_MergeRowCard> {
  late TextEditingController _amountController;
  late TextEditingController _currencyController;
  late TextEditingController _dateController;
  late TextEditingController _timeController;
  late TextEditingController _merchantController;

  @override
  void initState() {
    super.initState();
    _amountController = TextEditingController(text: widget.amountText ?? '');
    _currencyController = TextEditingController(text: widget.currencyText ?? '');
    _dateController = TextEditingController(text: widget.dateText ?? '');
    _timeController = TextEditingController(text: widget.timeText ?? '');
    _merchantController = TextEditingController(text: widget.merchantText ?? '');
  }

  @override
  void didUpdateWidget(_MergeRowCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.amountText != widget.amountText) _amountController.text = widget.amountText ?? '';
    if (oldWidget.currencyText != widget.currencyText) _currencyController.text = widget.currencyText ?? '';
    if (oldWidget.dateText != widget.dateText) _dateController.text = widget.dateText ?? '';
    if (oldWidget.timeText != widget.timeText) _timeController.text = widget.timeText ?? '';
    if (oldWidget.merchantText != widget.merchantText) _merchantController.text = widget.merchantText ?? '';
  }

  @override
  void dispose() {
    _amountController.dispose();
    _currencyController.dispose();
    _dateController.dispose();
    _timeController.dispose();
    _merchantController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (item.sourceSnippet != null && item.sourceSnippet!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text(
                  item.sourceSnippet!,
                  style: Theme.of(context).textTheme.bodySmall,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            TextField(
              controller: _amountController,
              decoration: const InputDecoration(
                labelText: 'Amount',
                isDense: true,
                border: OutlineInputBorder(),
              ),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              onChanged: widget.onAmountChanged,
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _currencyController,
                    decoration: const InputDecoration(
                      labelText: 'Currency',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onChanged: widget.onCurrencyChanged,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: _dateController,
                    decoration: const InputDecoration(
                      labelText: 'Date',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onChanged: widget.onDateChanged,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _timeController,
                    decoration: const InputDecoration(
                      labelText: 'Time',
                      isDense: true,
                      border: OutlineInputBorder(),
                    ),
                    onChanged: widget.onTimeChanged,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _merchantController,
              decoration: const InputDecoration(
                labelText: 'Merchant',
                isDense: true,
                border: OutlineInputBorder(),
              ),
              onChanged: widget.onMerchantChanged,
            ),
            const SizedBox(height: 8),
            if (widget.categories.isNotEmpty)
              DropdownButtonFormField<String>(
                value: widget.categoryId ?? widget.categories.first['id'] as String?,
                decoration: const InputDecoration(
                  labelText: 'Category',
                  isDense: true,
                  border: OutlineInputBorder(),
                ),
                items: widget.categories
                    .map((c) => DropdownMenuItem<String>(
                          value: c['id'] as String?,
                          child: Text(c['name'] as String? ?? ''),
                        ))
                    .toList(),
                onChanged: widget.onCategoryChanged,
              ),
            const SizedBox(height: 8),
            Text('Matched existing', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 4),
            if (widget.displayMatch != null)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(
                  '${widget.displayMatch!.amount.toStringAsFixed(2)} · ${widget.displayMatch!.date}',
                ),
                subtitle: Text(
                  '${widget.displayMatch!.categoryName}${widget.displayMatch!.merchant != null ? ' · ${widget.displayMatch!.merchant}' : ''}${widget.hasManualMatch ? ' (manual)' : ''}',
                ),
                trailing: TextButton(
                  onPressed: () => widget.onViewMatch(widget.displayMatch!),
                  child: const Text('View'),
                ),
              )
            else
              TextButton.icon(
                onPressed: widget.onMatchToTransaction,
                icon: const Icon(Icons.link),
                label: const Text('Match to a transaction'),
              ),
            const SizedBox(height: 8),
            Text('Action', style: Theme.of(context).textTheme.titleSmall),
            const SizedBox(height: 4),
            SegmentedButton<RowAction>(
              segments: const [
                ButtonSegment(value: RowAction.skip, label: Text('Confirm match'), icon: Icon(Icons.check)),
                ButtonSegment(value: RowAction.addNew, label: Text('Add as new'), icon: Icon(Icons.add)),
                ButtonSegment(value: RowAction.discard, label: Text('Discard'), icon: Icon(Icons.remove)),
              ],
              selected: {widget.action},
              onSelectionChanged: (s) {
                if (s.isNotEmpty) widget.onActionChanged(s.first);
              },
            ),
            if (widget.tags.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                children: widget.tags.map((tag) {
                  final id = tag['id'] as String?;
                  if (id == null) return const SizedBox.shrink();
                  final selected = widget.tagIds.contains(id);
                  return FilterChip(
                    label: Text(tag['name'] as String? ?? ''),
                    selected: selected,
                    onSelected: (_) => widget.onTagToggled(id),
                  );
                }).toList(),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
