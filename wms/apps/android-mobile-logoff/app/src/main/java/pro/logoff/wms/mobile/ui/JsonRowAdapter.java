package pro.logoff.wms.mobile.ui;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import java.util.ArrayList;
import java.util.List;

import pro.logoff.wms.mobile.databinding.ItemRowBinding;

public class JsonRowAdapter extends RecyclerView.Adapter<JsonRowAdapter.Holder> {
    public interface Listener { void onClick(Row row); }
    public static final class Row {
        private final String id;
        private final String title;
        private final String subtitle;
        private final String status;
        private final Object source;

        public Row(String id, String title, String subtitle, String status, Object source) {
            this.id = id;
            this.title = title;
            this.subtitle = subtitle;
            this.status = status;
            this.source = source;
        }

        public String id() { return id; }
        public String title() { return title; }
        public String subtitle() { return subtitle; }
        public String status() { return status; }
        public Object source() { return source; }
    }
    private final List<Row> rows = new ArrayList<>();
    private final Listener listener;
    public JsonRowAdapter(Listener listener) { this.listener = listener; }
    public void submit(List<Row> values) { rows.clear(); rows.addAll(values); notifyDataSetChanged(); }
    @NonNull @Override public Holder onCreateViewHolder(@NonNull ViewGroup parent, int type) { return new Holder(ItemRowBinding.inflate(LayoutInflater.from(parent.getContext()), parent, false)); }
    @Override public void onBindViewHolder(@NonNull Holder holder, int position) { holder.bind(rows.get(position)); }
    @Override public int getItemCount() { return rows.size(); }
    class Holder extends RecyclerView.ViewHolder {
        final ItemRowBinding binding;
        Holder(ItemRowBinding binding) { super(binding.getRoot()); this.binding = binding; }
        void bind(Row row) {
            binding.title.setText(row.title());
            binding.subtitle.setText(row.subtitle());
            binding.subtitle.setVisibility(row.subtitle().isEmpty() ? View.GONE : View.VISIBLE);
            binding.status.setText(StatusLabels.label(row.status()));
            binding.status.setVisibility(row.status().isEmpty() ? View.GONE : View.VISIBLE);
            int badgeBackground = pro.logoff.wms.mobile.R.drawable.status_background;
            int statusColor = pro.logoff.wms.mobile.R.color.logoff_red_dark;
            int cardBackground = pro.logoff.wms.mobile.R.color.logoff_card;
            int strokeColor = pro.logoff.wms.mobile.R.color.logoff_border;
            if ("PAID".equals(row.status()) || "DONE".equals(row.status())) {
                badgeBackground = pro.logoff.wms.mobile.R.drawable.status_background_success;
                statusColor = pro.logoff.wms.mobile.R.color.logoff_success;
                cardBackground = pro.logoff.wms.mobile.R.color.logoff_success_surface;
                strokeColor = pro.logoff.wms.mobile.R.color.logoff_success;
            } else if ("IN_WORK".equals(row.status())) {
                badgeBackground = pro.logoff.wms.mobile.R.drawable.status_background_work;
                statusColor = pro.logoff.wms.mobile.R.color.logoff_blue;
                cardBackground = pro.logoff.wms.mobile.R.color.logoff_blue_soft;
                strokeColor = pro.logoff.wms.mobile.R.color.logoff_blue;
            } else if ("CANCELLED".equals(row.status()) || "REJECTED".equals(row.status())) {
                badgeBackground = pro.logoff.wms.mobile.R.drawable.status_background;
                statusColor = pro.logoff.wms.mobile.R.color.logoff_red_dark;
                cardBackground = pro.logoff.wms.mobile.R.color.logoff_red_soft;
                strokeColor = pro.logoff.wms.mobile.R.color.logoff_red;
            }
            binding.status.setBackgroundResource(badgeBackground);
            binding.status.setTextColor(ContextCompat.getColor(binding.getRoot().getContext(), statusColor));
            binding.getRoot().setCardBackgroundColor(ContextCompat.getColor(binding.getRoot().getContext(), cardBackground));
            binding.getRoot().setStrokeColor(ContextCompat.getColor(binding.getRoot().getContext(), strokeColor));
            binding.getRoot().setOnClickListener(view -> listener.onClick(row));
        }
    }
}
