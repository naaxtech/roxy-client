const StripeProvider = ({ children }) => children;
const useStripe = () => ({ initPaymentSheet: async () => ({}), presentPaymentSheet: async () => ({}) });
module.exports = { StripeProvider, useStripe };
