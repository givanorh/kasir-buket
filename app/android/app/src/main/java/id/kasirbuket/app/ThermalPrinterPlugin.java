package id.kasirbuket.app;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Cetak mentah (ESC/POS) ke printer thermal:
 *  - Bluetooth Classic SPP (printer yang sudah dipasangkan/paired di pengaturan Bluetooth Android)
 *  - TCP port 9100 (printer WiFi/LAN)
 * Data dikirim dari JavaScript sebagai base64. Semua pencetakan diantrikan satu per satu.
 */
@CapacitorPlugin(
    name = "ThermalPrinter",
    permissions = {
        @Permission(alias = "bluetooth", strings = { "android.permission.BLUETOOTH_CONNECT" })
    }
)
public class ThermalPrinterPlugin extends Plugin {

    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final ExecutorService queue = Executors.newSingleThreadExecutor();

    private boolean needsBtPermission() {
        return Build.VERSION.SDK_INT >= 31 && getPermissionState("bluetooth") != PermissionState.GRANTED;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m != null ? m.getAdapter() : null;
    }

    @PluginMethod
    public void listPaired(PluginCall call) {
        if (needsBtPermission()) {
            requestPermissionForAlias("bluetooth", call, "btPermissionCallback");
            return;
        }
        doListPaired(call);
    }

    @PluginMethod
    public void printBluetooth(PluginCall call) {
        if (needsBtPermission()) {
            requestPermissionForAlias("bluetooth", call, "btPermissionCallback");
            return;
        }
        doPrintBluetooth(call);
    }

    @PermissionCallback
    private void btPermissionCallback(PluginCall call) {
        if (needsBtPermission()) {
            call.reject("Izin Bluetooth ditolak. Aktifkan izin Perangkat Sekitar untuk Kasir Buket.");
            return;
        }
        if ("listPaired".equals(call.getMethodName())) {
            doListPaired(call);
        } else {
            doPrintBluetooth(call);
        }
    }

    private void doListPaired(PluginCall call) {
        try {
            BluetoothAdapter a = adapter();
            JSArray arr = new JSArray();
            if (a != null && a.isEnabled()) {
                Set<BluetoothDevice> bonded = a.getBondedDevices();
                if (bonded != null) {
                    for (BluetoothDevice d : bonded) {
                        JSObject o = new JSObject();
                        String name = d.getName();
                        o.put("name", name != null ? name : "(tanpa nama)");
                        o.put("address", d.getAddress());
                        arr.put(o);
                    }
                }
            }
            JSObject ret = new JSObject();
            ret.put("devices", arr);
            ret.put("enabled", a != null && a.isEnabled());
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Izin Bluetooth belum diberikan", e);
        } catch (Exception e) {
            call.reject("Gagal membaca perangkat Bluetooth: " + e.getMessage(), e);
        }
    }

    private void doPrintBluetooth(final PluginCall call) {
        final String address = call.getString("address");
        final String data = call.getString("data");
        if (address == null || data == null) {
            call.reject("Alamat printer dan data wajib diisi");
            return;
        }
        queue.execute(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter a = adapter();
                if (a == null) throw new Exception("Perangkat ini tidak punya Bluetooth");
                if (!a.isEnabled()) throw new Exception("Bluetooth mati. Nyalakan Bluetooth dulu.");
                BluetoothDevice device = a.getRemoteDevice(address);
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                try {
                    socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    socket.connect();
                } catch (Exception first) {
                    // sebagian printer murah hanya menerima koneksi insecure
                    try { if (socket != null) socket.close(); } catch (Exception ignored) { }
                    socket = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
                    socket.connect();
                }
                OutputStream out = socket.getOutputStream();
                int chunk = 512;
                for (int i = 0; i < bytes.length; i += chunk) {
                    out.write(bytes, i, Math.min(chunk, bytes.length - i));
                    out.flush();
                    Thread.sleep(20);
                }
                Thread.sleep(300); // beri waktu buffer printer sebelum koneksi ditutup
                call.resolve();
            } catch (SecurityException e) {
                call.reject("Izin Bluetooth belum diberikan", e);
            } catch (Exception e) {
                call.reject("Gagal cetak Bluetooth: " + e.getMessage(), e);
            } finally {
                try { if (socket != null) socket.close(); } catch (Exception ignored) { }
            }
        });
    }

    @PluginMethod
    public void printTcp(final PluginCall call) {
        final String host = call.getString("host");
        final Integer port = call.getInt("port", 9100);
        final Integer timeout = call.getInt("timeout", 5000);
        final String data = call.getString("data");
        if (host == null || data == null) {
            call.reject("Alamat IP printer dan data wajib diisi");
            return;
        }
        queue.execute(() -> {
            Socket socket = new Socket();
            try {
                byte[] bytes = Base64.decode(data, Base64.DEFAULT);
                socket.connect(new InetSocketAddress(host, port), timeout);
                socket.setSoTimeout(timeout);
                OutputStream out = socket.getOutputStream();
                out.write(bytes);
                out.flush();
                Thread.sleep(150);
                call.resolve();
            } catch (Exception e) {
                call.reject("Gagal cetak ke " + host + ":" + port + " (" + e.getMessage() + ")", e);
            } finally {
                try { socket.close(); } catch (Exception ignored) { }
            }
        });
    }
}
