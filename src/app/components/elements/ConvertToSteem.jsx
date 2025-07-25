/* eslint react/prop-types: 0 */
import React from 'react';
import reactForm from 'app/utils/ReactForm';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as userActions from 'app/redux/UserReducer';
import * as appActions from 'app/redux/AppReducer';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import TransactionError from 'app/components/elements/TransactionError';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import tt from 'counterpart';
import { DEBT_TOKEN, DEBT_TICKER, LIQUID_TOKEN, APP_URL } from 'app/client_config';
import { connect } from 'react-redux';
import { FormattedHTMLMessage } from 'app/Translator';
import { api } from '@steemit/steem-js';
import * as globalActions from 'app/redux/GlobalReducer';
import { numberWithCommas } from 'app/utils/StateFunctions';
import { fetchData } from 'app/utils/steemApi';

class ConvertToSteem extends React.Component {
    constructor(props) {
        super(props);
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'ConvertToSteem');
        this.state = {
            toggle_check: false,
        };
        this.initForm(props);
    }

    componentDidMount() {
        this.isComponentMounted = true;
        const { prices, updatePrices } = this.props;
        const lastUpdate = prices.get('lastUpdate');
        const oneHour = 60 * 60 * 1000;
        const now = Date.now();
        if (!lastUpdate || now - lastUpdate > oneHour) {
            console.log('Updating prices: missing or older than 1 hour');
            updatePrices();
        }
        fetchData('condenser_api.get_current_median_history_price', [], 1).then(
            result => {
                try {
                    const baseSBDS = parseFloat(
                        result.base.split(' ')[0]
                    ); // SBD
                    const quoteSTEEM = parseFloat(
                        result.quote.split(' ')[0]
                    ); // STEEM
                    const marketRate = quoteSTEEM / baseSBDS;
                    this.updateMarketPrice(
                        baseSBDS,
                        quoteSTEEM,
                        marketRate
                    );
                } catch (error) {
                    console.error('Error parsing market data:', error);
                }
            }
        );
    }

    handleToggleChange = (event) => {
        this.setState({ toggle_check: event.target.checked });
    }

    updateMarketPrice = (baseSBDS, quoteSTEEM, marketRate) => {
        this.setState({ baseSBDS, quoteSTEEM, marketRate })
    }

    dispatchSubmit = () => {
        const { convert, currentUser, onClose } = this.props;
        const { amount } = this.state;
        const success = () => {
            this.setState({ loading: false });
            if (onClose) onClose();
        };
        const error = () => {
            this.setState({ loading: false });
        };
        this.setState({ loading: true });

        convert(currentUser, amount.value, success, error);
    };

    assetBalanceClick = e => {
        e.preventDefault();
        const current_sbd = this.props.sbd_balance
        if (current_sbd && typeof current_sbd === 'string') {
            this.state.amount.props.onChange(current_sbd.split(' ')[0]);
        }
    };

    initForm(props) {
        const fields = ['amount'];
        const { validate } = this.props
        reactForm({
            name: 'convertToSteem',
            instance: this,
            fields,
            initialValues: { amount: '' },
            validation: (values) => { return validate(values) }
        });
    }

    render() {
        const { onClose, currentUser, sbd_balance } = this.props;
        const { loading, amount, marketRate } = this.state;
        const { submitting, valid, handleSubmit } = this.state.convertToSteem;

        const { prices } = this.props;

        const steemPrice = prices.get('steemPrice') || 0;
        const sbdPrice = prices.get('sbdPrice') || 0;
        const amountValue = parseFloat(amount.value) || 0;
        const projectedSteem = amountValue && marketRate ? amountValue * marketRate : 0;
        const inUSD = amountValue * sbdPrice;
        const outUSD = projectedSteem * steemPrice;

        return (
            <div>
                <div className="row">
                    <h3 className="column">
                        {tt('converttosteem_jsx.convert_to_LIQUID_TOKEN', {
                            LIQUID_TOKEN: typeof LIQUID_TOKEN === 'string' ? LIQUID_TOKEN.toUpperCase() : LIQUID_TOKEN,
                        })}
                    </h3>
                </div>
                <form
                    onSubmit={handleSubmit(({ data }) => {
                        this.setState({ loading: true });
                        this.dispatchSubmit();
                    })}
                >
                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="converttosteem_jsx.visit_faq_for_more_details"
                                />
                            </div>
                        </div>
                        <br />
                    </div>
                    <div>
                        <div className="row">
                            <div className="column small-12" style={{ textAlign: 'justify' }}>
                                {tt(
                                    'converttosteem_jsx.DEBT_TOKEN_will_be_unavailable',
                                    { DEBT_TOKEN }
                                )}
                            </div>
                        </div>
                        <br />
                    </div>
                    <div>
                        <div className="row">
                            <div className="column small-12" style={{ textAlign: 'justify' }}>
                                {tt(
                                    'converttosteem_jsx.your_existing_DEBT_TOKEN_are_liquid_and_transferable',
                                    { link: tt('g.buy_or_sell'), DEBT_TOKEN }
                                )}
                            </div>
                        </div>
                        <br />
                    </div>
                    <div className="row">
                        <div className="column small-2" style={{ paddingTop: 5 }}>
                            {tt('converttosteem_jsx.account')}
                        </div>
                        <div className="column small-10">
                            <div
                                className="input-group"
                                style={{ marginBottom: '1.25rem' }}
                            >
                                <span className="input-group-label">@</span>
                                <input
                                    className="input-group-field bold"
                                    type="text"
                                    disabled
                                    value={currentUser}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="row">
                        <div className="column small-2" style={{ paddingTop: 5 }}>
                            {tt('g.amount')}
                        </div>
                        <div className="column small-10">
                            <div
                                className="input-group"
                                style={{ marginBottom: 5 }}
                            >
                                <input
                                    type="text"
                                    ref="amount"
                                    name="amount"
                                    {...amount.props}
                                    autoComplete="off"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck="false"
                                    disabled={loading}
                                />
                                <span
                                    className="input-group-label"
                                >
                                    SBD
                                </span>
                            </div>
                            <div style={{
                                marginBottom: '0.6rem',
                                display: 'flex',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap'
                            }}>
                                <AssetBalance
                                    balanceValue={sbd_balance}
                                    onClick={this.assetBalanceClick}
                                />
                            </div>

                        </div>
                    </div>
                    <div className="row">
                        <div className="column small-2" style={{ paddingTop: 5 }}>
                            {tt('converttosteem_jsx.projected')}
                        </div>
                        <div className="column small-10">
                            <div
                                className="input-group"
                                style={{ marginBottom: '1.25rem' }}
                            >
                                <input
                                    className="input-group-field bold"
                                    type="text"
                                    disabled
                                    value={(marketRate && amount && amount.value && parseFloat(amount.value)) ? (projectedSteem.toFixed(3)) : '0.000'}
                                />
                                <span
                                    className="input-group-label"
                                >
                                    STEEM
                                </span>
                            </div>
                        </div>
                    </div>
                    <div className="row">
                        <div className="column small-2" style={{ paddingTop: 5 }}>
                            {tt('converttosteem_jsx.efficiency')}
                        </div>
                        <div className="column small-10">
                            <div
                                className="input-group"
                                style={{ marginBottom: '1.25rem' }}
                            >
                                <input
                                    className="input-group-field bold"
                                    type="text"
                                    disabled
                                    value={tt(
                                        'converttosteem_jsx.efficiency_projected',
                                        { inUSD: numberWithCommas(inUSD.toFixed(2)), outUSD: numberWithCommas(outUSD.toFixed(2)) }
                                    )}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="row">
                        {(amount.touched && amount.error) ? (
                            <div className="error column small-12">
                                {amount.touched &&
                                    amount.error &&
                                    amount.error}&nbsp;
                            </div>
                            ) : null}
                    </div>
                    <div className="row">
                        <div className="column toggle_container">
                            <span>
                                {tt("transfer_jsx.toggle_exchange_message")}
                            </span>
                            <label className="switch">
                                <input
                                    name="toggle_check"
                                    type="checkbox"
                                    checked={this.state.toggle_check}
                                    ref="toggle_check"
                                    onChange={this.handleToggleChange}
                                />
                                <span className="slider round" />
                            </label>
                        </div>
                    </div>
                    <div className="row">
                        <div className="small-12 columns">
                            <TransactionError opType="convert" />
                            {loading && (
                                <span>
                                    <LoadingIndicator type="circle" />
                                </span>
                            )}
                            <div>
                                {!loading && (
                                    <button
                                        type="submit"
                                        disabled={
                                            submitting ||
                                            !valid ||
                                            !this.state.toggle_check
                                        }
                                        className="button"
                                    >
                                        {tt('g.convert')}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    disabled={submitting}
                                    className="button hollow float-right"
                                    onClick={onClose}
                                >
                                    {tt('g.cancel')}
                                </button>
                            </div>
                        </div>
                    </div>
                </form>
            </div>
        );
    }
}


const AssetBalance = ({ onClick, balanceValue }) => (
    <a
        onClick={onClick}
        style={{ borderBottom: '#A09F9F 1px dotted', cursor: 'pointer' }}
        role="button"
        tabIndex="0"
    >
        {tt('g.balance', { balanceValue })}
    </a>
);

export default connect(
    (state) => {
        const current = state.user.get('current');
        const username = current.get('username');
        const account = state.global.getIn(['accounts', username]);
        const sbd_balance = account.get('sbd_balance');
        const max = sbd_balance.split(' ')[0];
        const accounts = state.global.get('accounts');
        const prices = state.transaction.get('prices');
        const validate = values => ({
            amount: !values.amount
                ? tt('g.required')
                : isNaN(values.amount) || parseFloat(values.amount) <= 0
                  ? tt('g.invalid_amount')
                  : parseFloat(values.amount) > parseFloat(max)
                    ? tt('g.insufficient_balance')
                    : null,
        });
        return {
            currentUser: username,
            sbd_balance,
            accounts,
            prices,
            validate
        };
    },
    // mapDispatchToProps
    dispatch => ({
        convert: (owner, amt, success, error) => {
            const amount = [parseFloat(amt).toFixed(3), DEBT_TICKER].join(' ');
            const requestid = Math.floor(Date.now() / 1000);
            const conf = tt(
                'postfull_jsx.in_week_convert_DEBT_TOKEN_to_LIQUID_TOKEN',
                {
                    amount: amount.split(' ')[0],
                    DEBT_TOKEN,
                    LIQUID_TOKEN: typeof LIQUID_TOKEN === 'string' ? LIQUID_TOKEN.toUpperCase() : LIQUID_TOKEN,
                }
            );
            dispatch(
                transactionActions.broadcastOperation({
                    type: 'convert',
                    operation: { owner, requestid, amount },
                    confirm: conf + '?',
                    successCallback: () => {
                        dispatch(
                            globalActions.getState({ url: `@${owner}/transfers` })
                        );
                        dispatch(
                            userActions.refreshAccount({
                                owner,
                            })
                        );
                        success();
                        dispatch(
                            appActions.addNotification({
                                key: 'convert_sd_to_steem_' + Date.now(),
                                message: tt('g.order_placed', { order: conf }),
                                dismissAfter: 5000,
                            })
                        );
                        dispatch(
                            transactionActions.addConversion({
                                owner,
                                amount,
                                requestid,
                                timestamp: Date.now(),
                            })
                        );
                    },
                    errorCallback: error,
                })
            );
        },
        updatePrices: () => dispatch(transactionActions.updatePrices()),
    })
)(ConvertToSteem);
