import React, { Component } from 'react';
import tt from 'counterpart';
import { connect } from 'react-redux';
import * as userActions from 'app/redux/UserReducer';

const styles = {
    container: {
        display: 'flex',
        flexDirection: 'row',
        flexFlow: 'row wrap',
        marginTop: '40px',
    },
    flowBelow: {
        marginTop: '40px',
    },
};
// todo: refactor with tronCreateOne
class UpdateTronAccountOne extends Component {
    constructor() {
        super();
        this.state = {
            error_msg: '',
            error: false,
        };
        this.handleSubmit = e => {
            e.preventDefault();
            this.props.updateUser();
        };
    }

    componentWillMount() {
        this.props.resetError();
    }

    componentDidUpdate(prevProps) {
        // start to download pdf key file
        if (this.props.tron_create !== prevProps.tron_create) {
            this.props.hideUpdate();
            this.props.showUpdateSuccess();
        }
        if (this.props.tron_create_msg !== prevProps.tron_create_msg) {
            this.setState({
                err_msg: this.props.tron_create_msg,
                error: this.tron_create_msg == '' ? false : true,
            });
        }
    }

    render() {
        return (
            <div>
                <div>
                    <h3>{tt('tron_jsx.update_tron_account')}</h3>
                </div>
                <div style={styles.container}>
                    {this.state.error == false ? (
                        <div style={styles.container}>
                            <p> {tt('tron_jsx.update_tron_content')} </p>
                            <p> {tt('tron_jsx.update_tron_content1')} </p>
                            <p> {tt('tron_jsx.update_tron_content2')} </p>
                            <p> {tt('tron_jsx.update_tron_content3')} </p>
                            <p> {tt('tron_jsx.update_tron_content4')} </p>
                            <p> {tt('tron_jsx.update_tron_content5')} </p>
                        </div>
                    ) : (
                        <div>
                            <p> {this.props.tron_create_msg} </p>
                            <p>
                                {' '}
                                Fail to update a tron account, click button and
                                try again
                            </p>
                        </div>
                    )}
                </div>
                <div style={styles.flowBelow}>
                    <button
                        type="submit"
                        className="button"
                        onClick={this.handleSubmit}
                    >
                        {tt('tron_jsx.update_button')}
                    </button>
                </div>
            </div>
        );
    }
}

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const currentUser = state.user.get('current');
        const tron_create =
            currentUser && currentUser.has('tron_create')
                ? currentUser.get('tron_create')
                : false;
        const tron_create_msg =
            currentUser && currentUser.has('tron_create_msg')
                ? currentUser.get('tron_create_msg')
                : '';
        return {
            ...ownProps,
            tron_create,
            tron_create_msg,
        };
    },
    dispatch => ({
        showUpdateSuccess: () => {
            // if (e) e.preventDefault();
            // dispatch(userActions.hideUpdate());
            dispatch(userActions.showUpdateSuccess());
        },
        hideUpdate: () => {
            dispatch(userActions.hideUpdate());
        },
        updateUser: () => {
            dispatch(
                userActions.updateUser({
                    claim_reward: false,
                    tron_address: '',
                })
            );
        },
        resetError: () => {
            dispatch(userActions.resetError());
        },
    })
)(UpdateTronAccountOne);
