export const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-TZ', { style: 'currency', currency: 'TZS', minimumFractionDigits: 0 }).format(amount);
};

export const formatDate = (dateString) => {
    if(!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};