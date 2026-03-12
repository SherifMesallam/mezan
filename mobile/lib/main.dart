import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:provider/provider.dart';
import 'api.dart';
import 'app_state.dart';
import 'screens/auth_screen.dart';
import 'screens/home_screen.dart';
import 'screens/setup_screen.dart';

void main() {
  runApp(const MezanApp());
}

class MezanApp extends StatelessWidget {
  const MezanApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => AppState(),
      child: MaterialApp(
        title: 'Mezan',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal),
          useMaterial3: true,
        ),
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [
          Locale('en'),
          Locale('ar'),
        ],
        home: Consumer<AppState>(
          builder: (context, state, _) {
            if (state.isLoading) {
              return const Scaffold(
                body: Center(child: CircularProgressIndicator()),
              );
            }
            if (state.token == null) return const AuthScreen();
            return _SetupGate(state: state);
          },
        ),
      ),
    );
  }
}

class _SetupGate extends StatefulWidget {
  const _SetupGate({required this.state});

  final AppState state;

  @override
  State<_SetupGate> createState() => _SetupGateState();
}

class _SetupGateState extends State<_SetupGate> {
  bool? _setupCompleted;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _checkSetup();
  }

  Future<void> _checkSetup() async {
    try {
      final api = Api(
        baseUrl: widget.state.effectiveBaseUrl,
        token: widget.state.token,
      );
      final res = await api.get('/v1/setup/status');
      final completed = res['setup_completed_at'];
      if (mounted) {
        setState(() {
          _setupCompleted = completed != null;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _setupCompleted = false;
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_setupCompleted == true) {
      return const HomeScreen();
    }
    return SetupScreen(
      onComplete: () => setState(() => _setupCompleted = true),
    );
  }
}
